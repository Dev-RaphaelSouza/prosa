import { all, allRaw, get, run, tx } from '../db.ts';
import { DELETE, GET, PATCH, POST, PUT, fail, type Ctx } from '../http.ts';
import { channelAudience, channelFor, messagePayload, messagesPayload, permsIn, type ChannelRow, type MessageRow } from '../core.ts';
import { sendTo, sendToMany } from '../live.ts';
import { allow, now } from '../util.ts';
import { P } from '../../shared/perms.ts';
import type { Attachment } from '../../shared/types.ts';

const MENTION = /(?:^|[^\w@])@([a-z0-9_.]{3,20})/gi;
const EVERYONE = /(?:^|[^\w@])@todos\b/i;

function cleanAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((a) => {
    if (typeof a?.url !== 'string' || !/^\/uploads\/[a-z0-9]+\.[a-z0-9]+$/.test(a.url)) throw fail(400, 'Anexo inválido.');
    const out: Attachment = { url: a.url, name: String(a.name ?? 'arquivo').slice(0, 120), size: Number(a.size) || 0, type: String(a.type ?? '').slice(0, 80) };
    if (Number(a.w) > 0 && Number(a.h) > 0) {
      out.w = Math.round(Number(a.w));
      out.h = Math.round(Number(a.h));
    }
    return out;
  });
}

/** Resolve os @usuario do texto em ids, só entre quem enxerga o canal. */
function findMentions(ch: ChannelRow, content: string): string[] {
  const handles = [...new Set([...content.matchAll(MENTION)].map((m) => m[1].toLowerCase()))].slice(0, 30);
  if (!handles.length) return [];
  const marks = handles.map(() => '?').join(',');
  const rows = ch.server_id
    ? allRaw<{ id: string }>(
        `SELECT u.id FROM users u JOIN members m ON m.user_id = u.id WHERE m.server_id = ? AND u.handle IN (${marks})`,
        ch.server_id,
        ...handles,
      )
    : allRaw<{ id: string }>(`SELECT u.id FROM users u JOIN dm_members d ON d.user_id = u.id WHERE d.channel_id = ? AND u.handle IN (${marks})`, ch.id, ...handles);
  return rows.map((r) => r.id);
}

function messageFor(c: Ctx): { msg: MessageRow; ch: ChannelRow } {
  const msg = get<MessageRow>('SELECT * FROM messages WHERE id = ?', Number(c.params.id));
  if (!msg) throw fail(404, 'Mensagem não encontrada.');
  return { msg, ch: channelFor(c.user.id, msg.channel_id) };
}

const canModerate = (ch: ChannelRow, userId: string) => !!ch.server_id && ((permsIn(ch.server_id, userId) ?? 0) & P.MANAGE_MESSAGES) !== 0;

GET('/api/channels/:id/messages', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  const limit = Math.max(1, Math.min(Number(c.query.get('limit')) || 50, 100));
  const before = Number(c.query.get('before')) || Number.MAX_SAFE_INTEGER;
  const after = Number(c.query.get('after')) || 0;
  // Depois de reconectar o cliente pede só o que perdeu (after); senão, uma página pra trás (before).
  const rows = after
    ? all<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND id > ? ORDER BY id LIMIT ?', ch.id, after, limit)
    : all<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?', ch.id, before, limit).reverse();
  const read = get<{ last_id: number }>('SELECT last_id FROM reads WHERE channel_id = ? AND user_id = ?', ch.id, c.user.id);
  return { messages: messagesPayload(rows), hasMore: rows.length === limit, lastRead: read?.last_id ?? 0 };
});

POST('/api/channels/:id/messages', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  if (!allow('msg:' + c.user.id, 12, 6000)) throw fail(429, 'Calma, você está mandando mensagens rápido demais.');
  const content = typeof c.body.content === 'string' ? c.body.content.trim() : '';
  const attachments = cleanAttachments(c.body.attachments);
  if (!content && !attachments.length) throw fail(400, 'Mensagem vazia.');
  if (content.length > 4000) throw fail(400, 'A mensagem passa de 4000 caracteres.');

  const reply = c.body.replyTo ? get<{ id: number }>('SELECT id FROM messages WHERE id = ? AND channel_id = ?', Number(c.body.replyTo), ch.id) : undefined;
  const mentions = findMentions(ch, content);
  const everyone = EVERYONE.test(content) && !!ch.server_id && ((permsIn(ch.server_id, c.user.id) ?? 0) & P.MENTION_ALL) !== 0;

  const id = tx(() => {
    const r = run(
      'INSERT INTO messages (channel_id, author_id, content, reply_to, attachments, everyone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ch.id,
      c.user.id,
      content,
      reply?.id ?? null,
      JSON.stringify(attachments),
      everyone ? 1 : 0,
      now(),
    );
    const msgId = Number(r.lastInsertRowid);
    for (const userId of mentions) run('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)', msgId, userId);
    // Quem escreve leu até aqui.
    run('INSERT INTO reads (channel_id, user_id, last_id) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_id = excluded.last_id', ch.id, c.user.id, msgId);
    return msgId;
  });

  const msg = messagePayload(id)!;
  if (typeof c.body.nonce === 'string') msg.nonce = c.body.nonce.slice(0, 40);
  sendToMany(channelAudience(ch), 'msg.new', msg);
  return msg;
});

PATCH('/api/messages/:id', (c) => {
  const { msg, ch } = messageFor(c);
  if (msg.author_id !== c.user.id || msg.kind) throw fail(403, 'Só dá pra editar as suas mensagens.');
  const content = typeof c.body.content === 'string' ? c.body.content.trim() : '';
  if (!content && msg.attachments === '[]') throw fail(400, 'Mensagem vazia.');
  if (content.length > 4000) throw fail(400, 'A mensagem passa de 4000 caracteres.');
  const mentions = findMentions(ch, content);
  tx(() => {
    run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', content, now(), msg.id);
    run('DELETE FROM mentions WHERE message_id = ?', msg.id);
    for (const userId of mentions) run('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)', msg.id, userId);
  });
  const out = messagePayload(msg.id)!;
  sendToMany(channelAudience(ch), 'msg.update', out);
  return out;
});

DELETE('/api/messages/:id', (c) => {
  const { msg, ch } = messageFor(c);
  if (msg.author_id !== c.user.id && !canModerate(ch, c.user.id)) throw fail(403, 'Você não pode apagar essa mensagem.');
  run('DELETE FROM messages WHERE id = ?', msg.id);
  sendToMany(channelAudience(ch), 'msg.delete', { channelId: ch.id, id: msg.id });
});

function react(c: Ctx, add: boolean) {
  const { msg, ch } = messageFor(c);
  const emoji = c.params.emoji;
  if (!emoji || emoji.length > 16) throw fail(400, 'Reação inválida.');
  if (add) {
    const distinct = get<{ n: number }>('SELECT COUNT(DISTINCT emoji) n FROM reactions WHERE message_id = ?', msg.id)!.n;
    if (distinct >= 20 && !get('SELECT 1 x FROM reactions WHERE message_id = ? AND emoji = ?', msg.id, emoji)) throw fail(400, 'Essa mensagem já tem reações demais.');
    run('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', msg.id, c.user.id, emoji, now());
  } else run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', msg.id, c.user.id, emoji);
  const reactions = messagePayload(msg.id)!.reactions;
  sendToMany(channelAudience(ch), 'msg.react', { channelId: ch.id, id: msg.id, reactions });
  return { reactions };
}
PUT('/api/messages/:id/reactions/:emoji', (c) => react(c, true));
DELETE('/api/messages/:id/reactions/:emoji', (c) => react(c, false));

function pin(c: Ctx, on: boolean) {
  const { msg, ch } = messageFor(c);
  // Em DM qualquer um dos dois fixa; em servidor, só quem gerencia mensagens.
  if (ch.server_id && !canModerate(ch, c.user.id)) throw fail(403, 'Você não tem permissão pra fixar mensagens.');
  if (on && get<{ n: number }>('SELECT COUNT(*) n FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL', ch.id)!.n >= 50)
    throw fail(400, 'Este canal já tem 50 mensagens fixadas.');
  run('UPDATE messages SET pinned_at = ? WHERE id = ?', on ? now() : null, msg.id);
  const out = messagePayload(msg.id)!;
  sendToMany(channelAudience(ch), 'msg.update', out);
  return out;
}
PUT('/api/messages/:id/pin', (c) => pin(c, true));
DELETE('/api/messages/:id/pin', (c) => pin(c, false));

GET('/api/channels/:id/pins', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  return messagesPayload(all<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC', ch.id));
});

GET('/api/channels/:id/search', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  const q = (c.query.get('q') ?? '').trim().slice(0, 100);
  if (q.length < 2) return [];
  const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  return messagesPayload(
    all<MessageRow>("SELECT * FROM messages WHERE channel_id = ? AND kind IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 40", ch.id, like),
  );
});

POST('/api/channels/:id/read', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  const last = get<{ id: number | null }>('SELECT MAX(id) id FROM messages WHERE channel_id = ?', ch.id)?.id ?? 0;
  const lastId = Math.min(Number(c.body.lastId) || last, last);
  run(
    'INSERT INTO reads (channel_id, user_id, last_id) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_id = MAX(last_id, excluded.last_id)',
    ch.id,
    c.user.id,
    lastId,
  );
  // As outras abas da mesma pessoa limpam o contador junto.
  sendTo(c.user.id, 'read', { channelId: ch.id, lastId });
});

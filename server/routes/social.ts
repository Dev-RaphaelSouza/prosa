import { get, run, tx } from '../db.ts';
import { DELETE, POST, fail, text, type UserRow } from '../http.ts';
import { audienceOf, dmPayload, presenceOf, publicUser, userRow } from '../core.ts';
import { sendTo } from '../live.ts';
import { allow, newId, now } from '../util.ts';
import type { Friend } from '../../shared/types.ts';

interface FriendRow {
  a: string;
  b: string;
  status: string;
}

const between = (x: string, y: string) => get<FriendRow>('SELECT a, b, status FROM friends WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)', x, y);

/** Avisa os dois lados de como ficou a amizade (ou que acabou). Cada um recebe do seu ponto de vista. */
function notify(x: string, y: string) {
  const row = between(x, y);
  for (const [me, other] of [
    [x, y],
    [y, x],
  ]) {
    const user = userRow(other);
    if (!row || !user) {
      sendTo(me, 'friend.remove', { userId: other });
      continue;
    }
    const friend: Friend = { userId: other, status: row.status === 'accepted' ? 'accepted' : row.a === me ? 'outgoing' : 'incoming' };
    sendTo(me, 'friend.update', { friend, user: publicUser(user) });
    // Amizade aceita passa a mostrar presença de verdade.
    sendTo(me, 'presence', presenceOf(other));
  }
}

POST('/api/friends', (c) => {
  if (!allow('friend:' + c.user.id, 20, 10 * 60_000)) throw fail(429, 'Muitos pedidos de amizade em pouco tempo.');
  const handle = text(c.body.handle, 'Usuário', 21, 1).toLowerCase().replace(/^@/, '');
  const target = get<UserRow>('SELECT * FROM users WHERE handle = ?', handle);
  if (!target) throw fail(404, `Não achei ninguém com o usuário @${handle}.`);
  if (target.id === c.user.id) throw fail(400, 'Esse é você.');
  const row = between(c.user.id, target.id);
  if (row?.status === 'accepted') throw fail(409, 'Vocês já são amigos.');
  if (row && row.a === c.user.id) throw fail(409, 'Você já mandou um pedido pra essa pessoa.');
  // Pedido cruzado: se a outra pessoa já tinha pedido, vira amizade na hora.
  if (row) run("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?", row.a, row.b);
  else run("INSERT INTO friends (a, b, status, created_at) VALUES (?, ?, 'pending', ?)", c.user.id, target.id, now());
  notify(c.user.id, target.id);
});

POST('/api/friends/:userId/accept', (c) => {
  const row = between(c.user.id, c.params.userId);
  if (!row || row.status !== 'pending' || row.b !== c.user.id) throw fail(404, 'Não há pedido dessa pessoa.');
  run("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?", row.a, row.b);
  notify(c.user.id, c.params.userId);
});

// Serve pra recusar, cancelar um pedido e desfazer a amizade.
DELETE('/api/friends/:userId', (c) => {
  run('DELETE FROM friends WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)', c.user.id, c.params.userId);
  notify(c.user.id, c.params.userId);
});

POST('/api/dms', (c) => {
  const target = userRow(String(c.body.userId ?? ''));
  if (!target || target.id === c.user.id) throw fail(404, 'Pessoa não encontrada.');
  const existing = get<{ channel_id: string }>(
    'SELECT d1.channel_id FROM dm_members d1 JOIN dm_members d2 ON d2.channel_id = d1.channel_id WHERE d1.user_id = ? AND d2.user_id = ?',
    c.user.id,
    target.id,
  );
  if (existing) return { channel: dmPayload(existing.channel_id, c.user.id) };
  // Conversa nova só com quem você já enxerga: amigo ou colega de servidor.
  if (!audienceOf(c.user.id).includes(target.id)) throw fail(403, 'Vocês precisam ser amigos ou dividir um servidor pra conversar.');
  const id = newId();
  tx(() => {
    run("INSERT INTO channels (id, kind, created_at) VALUES (?, 'dm', ?)", id, now());
    run('INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?), (?, ?)', id, c.user.id, id, target.id);
  });
  sendTo(c.user.id, 'dm.open', { channel: dmPayload(id, c.user.id), user: publicUser(target) });
  sendTo(target.id, 'dm.open', { channel: dmPayload(id, target.id), user: publicUser(c.user) });
  return { channel: dmPayload(id, c.user.id) };
});

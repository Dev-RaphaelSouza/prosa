// O miolo que as rotas e o gateway compartilham: formatos de saída, permissões e avisos em tempo real.
import { all, allRaw, get, run } from './db.ts';
import { fail, type UserRow } from './http.ts';
import { isOnline, onRoomEmpty, onRoomLeave, pack, rooms, sendToMany, userRoom } from './live.ts';
import { now, parseJson } from './util.ts';
import { ALL_PERMS, P } from '../shared/perms.ts';
import type {
  Attachment,
  Bootstrap,
  Channel,
  ChannelKind,
  DriveMode,
  Focus,
  Friend,
  IceServer,
  Me,
  Message,
  Reaction,
  Server,
  ServerTheme,
  Status,
  Unread,
  User,
  VoiceState,
} from '../shared/types.ts';

export interface ServerRow {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  theme: string;
  perms: number;
  focus: string;
  created_at: number;
}
export interface ChannelRow {
  id: string;
  server_id: string | null;
  kind: ChannelKind;
  name: string;
  topic: string;
  category: string;
  position: number;
  drive_mode: DriveMode;
  created_at: number;
}
export interface MessageRow {
  id: number;
  channel_id: string;
  author_id: string;
  content: string;
  kind: string | null;
  reply_to: number | null;
  attachments: string;
  everyone: number;
  created_at: number;
  edited_at: number | null;
  pinned_at: number | null;
}

// ---------- usuários ----------

export function publicUser(u: UserRow): User {
  return {
    id: u.id,
    handle: u.handle,
    name: u.name,
    avatar: u.avatar,
    banner: u.banner,
    accent: u.accent,
    bio: u.bio,
    pronouns: u.pronouns,
    // Invisível aparece como offline pra todo mundo, menos pra própria pessoa (ver mePayload).
    status: isOnline(u.id) && u.status !== 'invisible' ? (u.status as Status) : 'offline',
    statusText: u.status_text,
  };
}

export const mePayload = (u: UserRow): Me => ({ ...publicUser(u), status: u.status as Status, email: u.email });

export const userRow = (id: string) => get<UserRow>('SELECT * FROM users WHERE id = ?', id);

/** Todo mundo que enxerga esta pessoa: quem divide servidor, amizade ou DM com ela (e ela mesma). */
export function audienceOf(userId: string): string[] {
  const rows = all<{ id: string }>(
    `SELECT m2.user_id id FROM members m1 JOIN members m2 ON m2.server_id = m1.server_id WHERE m1.user_id = ?1
     UNION SELECT b FROM friends WHERE a = ?1
     UNION SELECT a FROM friends WHERE b = ?1
     UNION SELECT d2.user_id FROM dm_members d1 JOIN dm_members d2 ON d2.channel_id = d1.channel_id WHERE d1.user_id = ?1`,
    userId,
  );
  const ids = new Set(rows.map((r) => r.id));
  ids.add(userId);
  return [...ids];
}

export function broadcastUser(userId: string) {
  const row = userRow(userId);
  if (row) sendToMany(audienceOf(userId), 'user.update', publicUser(row));
}

// ---------- servidores ----------

export const defaultFocus = (): Focus => ({ phase: 'idle', endsAt: null, focusMin: 25, breakMin: 5, round: 0, tasks: [] });

export const channelPayload = (c: ChannelRow): Channel => ({
  id: c.id,
  serverId: c.server_id,
  kind: c.kind,
  name: c.name,
  topic: c.topic,
  category: c.category,
  position: c.position,
  driveMode: c.drive_mode,
});

export function serverPayload(id: string): Server | null {
  const s = get<ServerRow>('SELECT * FROM servers WHERE id = ?', id);
  if (!s) return null;
  const rolesOf = new Map<string, string[]>();
  for (const r of all<{ user_id: string; role_id: string }>('SELECT user_id, role_id FROM member_roles WHERE server_id = ?', id)) {
    const list = rolesOf.get(r.user_id);
    if (list) list.push(r.role_id);
    else rolesOf.set(r.user_id, [r.role_id]);
  }
  return {
    id: s.id,
    name: s.name,
    icon: s.icon,
    ownerId: s.owner_id,
    theme: parseJson<ServerTheme>(s.theme, {}),
    perms: s.perms,
    focus: { ...defaultFocus(), ...parseJson<Partial<Focus>>(s.focus, {}) },
    channels: all<ChannelRow>('SELECT * FROM channels WHERE server_id = ? ORDER BY position, created_at', id).map(channelPayload),
    roles: all<{ id: string; name: string; color: string; perms: number; position: number }>(
      'SELECT id, name, color, perms, position FROM roles WHERE server_id = ? ORDER BY position DESC',
      id,
    ).map((r) => ({ ...r, serverId: id })),
    members: all<{ user_id: string; joined_at: number }>('SELECT user_id, joined_at FROM members WHERE server_id = ? ORDER BY joined_at', id).map(
      (m) => ({ userId: m.user_id, roles: rolesOf.get(m.user_id) ?? [], joinedAt: m.joined_at }),
    ),
  };
}

export const memberIds = (serverId: string) =>
  all<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = ?', serverId).map((r) => r.user_id);

export const usersOfServer = (serverId: string) =>
  all<UserRow>('SELECT u.* FROM users u JOIN members m ON m.user_id = u.id WHERE m.server_id = ?', serverId).map(publicUser);

/** Manda o servidor inteiro de novo pra todos os membros. Simples, e nesta escala sai barato. */
export function syncServer(serverId: string) {
  const server = serverPayload(serverId);
  if (server) sendToMany(memberIds(serverId), 'server.sync', { server, users: usersOfServer(serverId) });
}

export const isMember = (serverId: string, userId: string) =>
  !!get('SELECT 1 x FROM members WHERE server_id = ? AND user_id = ?', serverId, userId);

/** Permissões efetivas de alguém num servidor, ou null se não for membro. */
export function permsIn(serverId: string, userId: string): number | null {
  const s = get<{ owner_id: string; perms: number }>('SELECT owner_id, perms FROM servers WHERE id = ?', serverId);
  if (!s || !isMember(serverId, userId)) return null;
  if (s.owner_id === userId) return ALL_PERMS;
  let perms = s.perms;
  for (const r of all<{ perms: number }>(
    'SELECT r.perms FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.server_id = ? AND mr.user_id = ?',
    serverId,
    userId,
  ))
    perms |= r.perms;
  return perms & P.ADMIN ? ALL_PERMS : perms;
}

/** Exige que a pessoa seja membro e tenha a permissão (bit 0 = basta ser membro). */
export function need(serverId: string, userId: string, bit = 0): number {
  const perms = permsIn(serverId, userId);
  if (perms === null) throw fail(404, 'Servidor não encontrado.');
  if (bit && !(perms & bit)) throw fail(403, 'Você não tem permissão pra isso.');
  return perms;
}

export function rankIn(serverId: string, userId: string): number {
  const s = get<{ owner_id: string }>('SELECT owner_id FROM servers WHERE id = ?', serverId);
  if (s?.owner_id === userId) return Number.MAX_SAFE_INTEGER;
  const r = get<{ top: number | null }>(
    'SELECT MAX(r.position) top FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.server_id = ? AND mr.user_id = ?',
    serverId,
    userId,
  );
  return r?.top ?? 0;
}

export function log(serverId: string, actorId: string, action: string, target = '', detail = '') {
  run('INSERT INTO modlog (server_id, actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)', serverId, actorId, action, target, detail, now());
}

// ---------- canais ----------

export const channelRow = (id: string) => get<ChannelRow>('SELECT * FROM channels WHERE id = ?', id);

/** O canal, se a pessoa pode vê-lo. Responde 404 nos dois casos pra não revelar o que existe. */
export function channelFor(userId: string, channelId: string): ChannelRow {
  const ch = channelRow(channelId);
  const ok =
    ch &&
    (ch.server_id ? isMember(ch.server_id, userId) : !!get('SELECT 1 x FROM dm_members WHERE channel_id = ? AND user_id = ?', ch.id, userId));
  if (!ok) throw fail(404, 'Canal não encontrado.');
  return ch;
}

export function channelAudience(ch: ChannelRow): string[] {
  if (ch.server_id) return memberIds(ch.server_id);
  return all<{ user_id: string }>('SELECT user_id FROM dm_members WHERE channel_id = ?', ch.id).map((r) => r.user_id);
}

export function dmPayload(channelId: string, viewerId: string): Channel | null {
  const ch = channelRow(channelId);
  if (!ch) return null;
  const other = get<{ user_id: string }>('SELECT user_id FROM dm_members WHERE channel_id = ? AND user_id != ?', channelId, viewerId);
  const last = get<{ id: number | null }>('SELECT MAX(id) id FROM messages WHERE channel_id = ?', channelId);
  return { ...channelPayload(ch), recipientId: other?.user_id ?? viewerId, lastId: last?.id ?? 0 };
}

// ---------- mensagens ----------

export function messagesPayload(rows: MessageRow[]): Message[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');

  const reactions = new Map<number, Reaction[]>();
  for (const r of allRaw<{ message_id: number; user_id: string; emoji: string }>(
    `SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${marks}) ORDER BY created_at`,
    ...ids,
  )) {
    let list = reactions.get(r.message_id);
    if (!list) reactions.set(r.message_id, (list = []));
    const found = list.find((x) => x.emoji === r.emoji);
    if (found) found.users.push(r.user_id);
    else list.push({ emoji: r.emoji, users: [r.user_id] });
  }

  const mentions = new Map<number, string[]>();
  for (const m of allRaw<{ message_id: number; user_id: string }>(`SELECT message_id, user_id FROM mentions WHERE message_id IN (${marks})`, ...ids)) {
    const list = mentions.get(m.message_id);
    if (list) list.push(m.user_id);
    else mentions.set(m.message_id, [m.user_id]);
  }

  const replyIds = [...new Set(rows.map((r) => r.reply_to).filter((x): x is number => x !== null))];
  const replies = new Map<number, { id: number; author_id: string; content: string; attachments: string }>();
  if (replyIds.length)
    for (const r of allRaw<{ id: number; author_id: string; content: string; attachments: string }>(
      `SELECT id, author_id, content, attachments FROM messages WHERE id IN (${replyIds.map(() => '?').join(',')})`,
      ...replyIds,
    ))
      replies.set(r.id, r);

  return rows.map((r) => {
    const reply = r.reply_to !== null ? replies.get(r.reply_to) : undefined;
    return {
      id: r.id,
      channelId: r.channel_id,
      authorId: r.author_id,
      content: r.content,
      kind: r.kind,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      pinnedAt: r.pinned_at,
      // Resposta a uma mensagem apagada vira null; o cliente mostra "mensagem apagada".
      replyTo: reply
        ? { id: reply.id, authorId: reply.author_id, content: reply.content.slice(0, 160) || (reply.attachments !== '[]' ? '📎 anexo' : '') }
        : r.reply_to !== null
          ? { id: r.reply_to, authorId: '', content: '' }
          : null,
      attachments: parseJson<Attachment[]>(r.attachments, []),
      reactions: reactions.get(r.id) ?? [],
      mentions: mentions.get(r.id) ?? [],
      everyone: !!r.everyone,
    };
  });
}

export const messagePayload = (id: number): Message | undefined => {
  const row = get<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
  return row ? messagesPayload([row])[0] : undefined;
};

/** Mensagem do sistema (alguém entrou etc.) no primeiro canal de texto do servidor. */
export function systemMessage(serverId: string, authorId: string, kind: string) {
  const ch = get<ChannelRow>("SELECT * FROM channels WHERE server_id = ? AND kind = 'text' ORDER BY position, created_at LIMIT 1", serverId);
  if (!ch) return;
  const r = run('INSERT INTO messages (channel_id, author_id, content, kind, created_at) VALUES (?, ?, ?, ?, ?)', ch.id, authorId, '', kind, now());
  const msg = messagePayload(Number(r.lastInsertRowid));
  if (msg) sendToMany(memberIds(serverId), 'msg.new', msg);
}

// ---------- entrada e saída de membros ----------

export function addMember(serverId: string, userId: string) {
  run('INSERT OR IGNORE INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', serverId, userId, now());
  // Quem chega não herda o histórico inteiro como "não lido".
  run(
    `INSERT OR REPLACE INTO reads (channel_id, user_id, last_id)
     SELECT c.id, ?, COALESCE((SELECT MAX(id) FROM messages WHERE channel_id = c.id), 0) FROM channels c WHERE c.server_id = ?`,
    userId,
    serverId,
  );
  systemMessage(serverId, userId, 'join');
  syncServer(serverId);
  sendToMany(audienceOf(userId), 'presence', presenceOf(userId));
}

export function removeMember(serverId: string, userId: string) {
  const inRoom = userRoom.get(userId);
  if (inRoom && channelRow(inRoom)?.server_id === serverId) leaveVoice(userId, 'removido');
  run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', serverId, userId);
  run('DELETE FROM members WHERE server_id = ? AND user_id = ?', serverId, userId);
  sendToMany([userId], 'server.delete', { id: serverId });
  syncServer(serverId);
}

// ---------- presença e voz ----------

export function presenceOf(userId: string): { userId: string; status: Status } {
  const row = userRow(userId);
  return { userId, status: row ? publicUser(row).status : 'offline' };
}

export function leaveVoice(userId: string, reason?: string) {
  const channelId = userRoom.get(userId);
  if (!channelId) return;
  const room = rooms.get(channelId);
  const member = room?.get(userId);
  userRoom.delete(userId);
  room?.delete(userId);
  if (member && reason) member.conn.ws.send(pack('voice.kicked', { reason }));
  const ch = channelRow(channelId);
  if (ch) sendToMany(channelAudience(ch), 'voice.state', { channelId, userId, state: null });
  for (const hook of onRoomLeave) hook(channelId, userId);
  if (room && !room.size) {
    rooms.delete(channelId);
    for (const hook of onRoomEmpty) hook(channelId);
  }
}

// ---------- carga inicial ----------

function iceServers(): IceServer[] {
  const fallback: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  return process.env.ICE_SERVERS ? parseJson<IceServer[]>(process.env.ICE_SERVERS, fallback) : fallback;
}

export const features = { browser: false };

export function bootstrap(user: UserRow): Omit<Bootstrap, 'browsers'> {
  const servers = all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ? ORDER BY joined_at', user.id)
    .map((r) => serverPayload(r.server_id))
    .filter((s): s is Server => !!s);

  const dms = all<{ channel_id: string }>('SELECT channel_id FROM dm_members WHERE user_id = ?', user.id)
    .map((r) => dmPayload(r.channel_id, user.id))
    .filter((c): c is Channel => !!c);

  const friends: Friend[] = all<{ a: string; b: string; status: string }>('SELECT a, b, status FROM friends WHERE a = ?1 OR b = ?1', user.id).map(
    (f) => ({
      userId: f.a === user.id ? f.b : f.a,
      status: f.status === 'accepted' ? 'accepted' : f.a === user.id ? 'outgoing' : 'incoming',
    }),
  );

  const audience = audienceOf(user.id);
  const users = allRaw<UserRow>(`SELECT * FROM users WHERE id IN (${audience.map(() => '?').join(',')})`, ...audience).map(publicUser);

  const unread: Record<string, Unread> = {};
  for (const r of all<{ channel_id: string; count: number; mentions: number }>(
    `SELECT m.channel_id, COUNT(*) count,
       SUM(CASE WHEN m.everyone = 1 OR EXISTS (SELECT 1 FROM mentions x WHERE x.message_id = m.id AND x.user_id = ?1) THEN 1 ELSE 0 END) mentions
     FROM messages m LEFT JOIN reads r ON r.channel_id = m.channel_id AND r.user_id = ?1
     WHERE m.channel_id IN (
       SELECT id FROM channels WHERE server_id IN (SELECT server_id FROM members WHERE user_id = ?1)
       UNION SELECT channel_id FROM dm_members WHERE user_id = ?1)
       AND m.id > COALESCE(r.last_id, 0) AND m.author_id != ?1 AND m.kind IS NULL
     GROUP BY m.channel_id`,
    user.id,
  ))
    unread[r.channel_id] = { count: r.count, mentions: r.mentions };

  const visible = new Set<string>(dms.map((c) => c.id));
  for (const s of servers) for (const c of s.channels) visible.add(c.id);
  const voice: Record<string, Record<string, VoiceState>> = {};
  for (const [channelId, room] of rooms) {
    if (!visible.has(channelId)) continue;
    voice[channelId] = {};
    for (const [userId, m] of room) voice[channelId][userId] = m.state;
  }

  return { me: mePayload(user), users, servers, dms, friends, unread, voice, ice: iceServers(), features };
}

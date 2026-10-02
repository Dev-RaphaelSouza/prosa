// Estado vivo do servidor: quem está conectado e quem está em cada chamada. Nada daqui vai pro banco.
import type { WebSocket } from 'ws';
import type { VoiceState } from '../shared/types.ts';

export interface Conn {
  id: string;
  ws: WebSocket;
  userId: string;
  alive: boolean;
}

export const byUser = new Map<string, Set<Conn>>();
export const isOnline = (userId: string) => byUser.has(userId);

export const pack = (t: string, d: unknown) => JSON.stringify({ t, d });

export function sendTo(userId: string, t: string, d: unknown) {
  const conns = byUser.get(userId);
  if (!conns) return;
  const msg = pack(t, d);
  for (const c of conns) c.ws.send(msg);
}

export function sendToMany(userIds: Iterable<string>, t: string, d: unknown, except?: string) {
  const msg = pack(t, d);
  for (const id of userIds) {
    if (id === except) continue;
    const conns = byUser.get(id);
    if (conns) for (const c of conns) c.ws.send(msg);
  }
}

export interface RoomMember {
  conn: Conn;
  state: VoiceState;
}

/** canal → (usuário → conexão e estado na chamada). Cada pessoa fica em uma chamada só. */
export const rooms = new Map<string, Map<string, RoomMember>>();
export const userRoom = new Map<string, string>();

export function sendToRoom(channelId: string, t: string, d: unknown, except?: string) {
  const room = rooms.get(channelId);
  if (!room) return;
  const msg = pack(t, d);
  for (const [userId, m] of room) if (userId !== except) m.conn.ws.send(msg);
}

/** Avisados quando alguém sai de uma chamada e quando a última pessoa sai (o navegador da sala fecha junto). */
export const onRoomLeave: ((channelId: string, userId: string) => void)[] = [];
export const onRoomEmpty: ((channelId: string) => void)[] = [];

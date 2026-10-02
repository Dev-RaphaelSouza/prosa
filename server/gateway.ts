// O canal em tempo real: uma conexão WebSocket por aba, com presença, digitação, voz e sinalização WebRTC.
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { audienceOf, channelAudience, channelRow, isMember, leaveVoice, presenceOf, type ChannelRow } from './core.ts';
import { get } from './db.ts';
import { userByToken } from './http.ts';
import { byUser, pack, rooms, sendToMany, sendToRoom, userRoom, type Conn } from './live.ts';
import { browserOp, browserWelcome } from './browser.ts';
import { allow, newId } from './util.ts';
import type { VoiceState } from '../shared/types.ts';

// Recarregar a página derruba e reabre a conexão: a pessoa só vira "offline" se não voltar logo.
const OFFLINE_GRACE = 4000;
const goingOffline = new Map<string, NodeJS.Timeout>();

function register(ws: WebSocket, userId: string): Conn {
  const conn: Conn = { id: newId(), ws, userId, alive: true };
  const set = byUser.get(userId);
  if (set) set.add(conn);
  else {
    byUser.set(userId, new Set([conn]));
    clearTimeout(goingOffline.get(userId));
    goingOffline.delete(userId);
    sendToMany(audienceOf(userId), 'presence', presenceOf(userId));
  }
  return conn;
}

function unregister(conn: Conn) {
  const { userId } = conn;
  const channelId = userRoom.get(userId);
  if (channelId && rooms.get(channelId)?.get(userId)?.conn === conn) leaveVoice(userId);
  const set = byUser.get(userId);
  if (!set) return;
  set.delete(conn);
  if (set.size) return;
  byUser.delete(userId);
  goingOffline.set(
    userId,
    setTimeout(() => {
      goingOffline.delete(userId);
      if (!byUser.has(userId)) sendToMany(audienceOf(userId), 'presence', { userId, status: 'offline' });
    }, OFFLINE_GRACE),
  );
}

/** O canal, se existir e a pessoa puder vê-lo; aqui erro vira silêncio em vez de exceção. */
function visibleChannel(userId: string, channelId: unknown): ChannelRow | null {
  if (typeof channelId !== 'string') return null;
  const ch = channelRow(channelId);
  if (!ch) return null;
  const ok = ch.server_id ? isMember(ch.server_id, userId) : !!get('SELECT 1 x FROM dm_members WHERE channel_id = ? AND user_id = ?', ch.id, userId);
  return ok ? ch : null;
}

const streamId = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : undefined);

function cleanState(d: any): VoiceState {
  return {
    muted: !!d?.muted,
    deaf: !!d?.deaf,
    cam: !!d?.cam,
    screen: !!d?.screen,
    hand: !!d?.hand,
    streams: { mic: streamId(d?.streams?.mic), cam: streamId(d?.streams?.cam), screen: streamId(d?.streams?.screen) },
  };
}

/** A sala em que esta conexão (e não outra aba da mesma pessoa) está. */
function roomOf(conn: Conn): string | null {
  const channelId = userRoom.get(conn.userId);
  return channelId && rooms.get(channelId)?.get(conn.userId)?.conn === conn ? channelId : null;
}

function handle(conn: Conn, t: string, d: any) {
  const { userId } = conn;
  switch (t) {
    case 'ping':
      conn.ws.send(pack('pong', d));
      return;

    case 'typing': {
      if (!allow('typing:' + userId, 4, 5000)) return;
      const ch = visibleChannel(userId, d.channelId);
      if (ch) sendToMany(channelAudience(ch), 'typing', { channelId: ch.id, userId }, userId);
      return;
    }

    case 'voice.join': {
      const ch = visibleChannel(userId, d.channelId);
      if (!ch || ch.kind === 'text') return;
      // Uma chamada por pessoa: entrar de outro lugar derruba a anterior.
      if (userRoom.has(userId)) leaveVoice(userId, roomOf(conn) ? undefined : 'outra-aba');
      let room = rooms.get(ch.id);
      if (!room) rooms.set(ch.id, (room = new Map()));
      if (room.size >= 12) {
        conn.ws.send(pack('voice.kicked', { reason: 'cheia' }));
        return;
      }
      const state = cleanState(d.state);
      const peers = [...room.keys()];
      room.set(userId, { conn, state });
      userRoom.set(userId, ch.id);
      conn.ws.send(pack('voice.joined', { channelId: ch.id, peers }));
      sendToMany(channelAudience(ch), 'voice.state', { channelId: ch.id, userId, state });
      browserWelcome(conn, ch.id);
      return;
    }

    case 'voice.leave':
      if (roomOf(conn)) leaveVoice(userId);
      return;

    case 'voice.state': {
      const channelId = roomOf(conn);
      const ch = channelId && channelRow(channelId);
      if (!ch) return;
      const state = cleanState(d);
      rooms.get(ch.id)!.get(userId)!.state = state;
      sendToMany(channelAudience(ch), 'voice.state', { channelId: ch.id, userId, state });
      return;
    }

    case 'voice.speaking': {
      const channelId = roomOf(conn);
      if (channelId) sendToRoom(channelId, 'voice.speaking', { userId, on: !!d.on }, userId);
      return;
    }

    case 'voice.react': {
      const channelId = roomOf(conn);
      if (channelId && typeof d.emoji === 'string' && d.emoji.length <= 16 && allow('vreact:' + userId, 10, 5000))
        sendToRoom(channelId, 'voice.react', { userId, emoji: d.emoji });
      return;
    }

    // Oferta, resposta e candidatos ICE só passam entre duas pessoas da mesma sala.
    case 'rtc.signal': {
      const channelId = roomOf(conn);
      const peer = channelId && typeof d.to === 'string' ? rooms.get(channelId)?.get(d.to) : undefined;
      if (peer) peer.conn.ws.send(pack('rtc.signal', { from: userId, data: d.data }));
      return;
    }

    default:
      if (t.startsWith('browser.')) void browserOp(conn, roomOf(conn), t, d);
  }
}

export function attachGateway(http: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  http.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      let conn: Conn | null = null;
      // O token vem na primeira mensagem, não na URL (URL vai parar em log de proxy).
      const timer = setTimeout(() => !conn && ws.close(4000, 'sem autenticação'), 8000);

      ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (typeof msg?.t !== 'string') return;
        if (!conn) {
          if (msg.t !== 'auth') return;
          const user = userByToken(String(msg.d));
          if (!user) return ws.close(4001, 'sessão inválida');
          clearTimeout(timer);
          conn = register(ws, user.id);
          ws.send(pack('ready', null));
          return;
        }
        try {
          handle(conn, msg.t, msg.d ?? {});
        } catch (e) {
          console.error('[gateway]', msg.t, e);
        }
      });
      ws.on('pong', () => conn && (conn.alive = true));
      ws.on('error', () => {});
      ws.on('close', () => {
        clearTimeout(timer);
        if (conn) unregister(conn);
      });
    });
  });

  // Conexão que não responde ao ping em 30s é encerrada (aba suspensa, rede que caiu sem avisar).
  setInterval(() => {
    for (const set of byUser.values())
      for (const conn of set) {
        if (!conn.alive) conn.ws.terminate();
        else {
          conn.alive = false;
          conn.ws.ping();
        }
      }
  }, 30_000).unref();
}

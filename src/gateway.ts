// Cliente do gateway: uma conexão WebSocket que se refaz sozinha e distribui os eventos por tipo.
import { session } from './api';

type Handler = (data: any) => void;

const handlers = new Map<string, Set<Handler>>();
let ws: WebSocket | null = null;
let ready = false;
let attempts = 0;
let retryTimer: number | undefined;
let pingTimer: number | undefined;
let stopped = true;

function emit(type: string, data: unknown) {
  const set = handlers.get(type);
  if (set) for (const fn of [...set]) fn(data);
}

function open() {
  if (stopped || ws) return;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket.binaryType = 'arraybuffer';
  ws = socket;

  socket.onopen = () => socket.send(JSON.stringify({ t: 'auth', d: session.token }));

  socket.onmessage = (e) => {
    // Binário é sempre um quadro do navegador da sala.
    if (typeof e.data !== 'string') return emit('browser.frame', e.data);
    const msg = JSON.parse(e.data);
    if (msg.t === 'ready') {
      ready = true;
      emit(attempts ? '$reconnect' : '$connect', null);
      attempts = 0;
      clearInterval(pingTimer);
      pingTimer = window.setInterval(() => gateway.send('ping', performance.now()), 10_000);
      gateway.send('ping', performance.now());
      return;
    }
    if (msg.t === 'pong') return emit('$latency', Math.round(performance.now() - msg.d));
    emit(msg.t, msg.d);
  };

  socket.onclose = (e) => {
    if (ws !== socket) return;
    ws = null;
    clearInterval(pingTimer);
    if (ready) emit('$disconnect', null);
    ready = false;
    if (stopped) return;
    // 4001 = o servidor recusou a sessão: não adianta insistir.
    if (e.code === 4001) return session.onExpired();
    attempts++;
    retryTimer = window.setTimeout(open, Math.min(500 * 2 ** Math.min(attempts, 5), 10_000) + Math.random() * 400);
  };
}

export const gateway = {
  start() {
    stopped = false;
    attempts = 0;
    open();
  },
  stop() {
    stopped = true;
    clearTimeout(retryTimer);
    const socket = ws;
    ws = null;
    ready = false;
    socket?.close();
  },
  send(t: string, d: unknown = {}) {
    if (ws && ready) ws.send(JSON.stringify({ t, d }));
  },
  on(type: string, fn: Handler): () => void {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  },
  get ready() {
    return ready;
  },
};

// Voltou a rede ou a aba: tenta de novo na hora em vez de esperar o próximo ciclo.
const retryNow = () => {
  if (stopped || ws) return;
  clearTimeout(retryTimer);
  open();
};
window.addEventListener('online', retryNow);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && retryNow());

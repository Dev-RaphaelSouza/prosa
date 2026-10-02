// O estado do app: o que veio do servidor (useApp) e o que é só da interface (useUi).
import type { ReactNode } from 'react';
import { create } from 'zustand';
import { api, errorText, session } from './api';
import { gateway } from './gateway';
import { notifyMessage, playSound, systemNotify } from './lib/notify';
import type {
  Attachment,
  Bootstrap,
  BrowserState,
  Channel,
  Focus,
  Friend,
  IceServer,
  Me,
  Message,
  Server,
  Status,
  Unread,
  User,
  VoiceState,
} from '../shared/types';

export type ClientMessage = Message & { pending?: boolean; failed?: boolean };

export interface ChannelLog {
  list: ClientMessage[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  /** Id da última mensagem lida quando o canal foi aberto: a linha de "novas" fica depois dela. */
  divider: number;
}

export type Route =
  | { page: 'home' }
  | { page: 'dm'; channelId: string }
  | { page: 'server'; serverId: string; channelId: string | null }
  | { page: 'invite'; code: string }
  | { page: 'reset'; token: string };

interface AppState {
  phase: 'boot' | 'auth' | 'ready' | 'error';
  connected: boolean;
  me: Me | null;
  users: Record<string, User>;
  servers: Record<string, Server>;
  serverOrder: string[];
  dms: Record<string, Channel>;
  friends: Record<string, Friend>;
  unread: Record<string, Unread>;
  voice: Record<string, Record<string, VoiceState>>;
  browsers: Record<string, BrowserState>;
  logs: Record<string, ChannelLog>;
  typing: Record<string, Record<string, number>>;
  ice: IceServer[];
  features: { browser: boolean };
  route: Route;
}

function parseRoute(path: string): Route {
  const [, a, b, c] = path.split('/');
  if (a === 's' && b) return { page: 'server', serverId: b, channelId: c || null };
  if (a === 'dm' && b) return { page: 'dm', channelId: b };
  if (a === 'convite' && b) return { page: 'invite', code: b };
  if (a === 'redefinir' && b) return { page: 'reset', token: b };
  return { page: 'home' };
}

export const useApp = create<AppState>(() => ({
  phase: 'boot',
  connected: false,
  me: null,
  users: {},
  servers: {},
  serverOrder: [],
  dms: {},
  friends: {},
  unread: {},
  voice: {},
  browsers: {},
  logs: {},
  typing: {},
  ice: [],
  features: { browser: false },
  route: parseRoute(location.pathname),
}));

const set = useApp.setState;
const get = useApp.getState;

// ---------- interface ----------

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

export type Modal =
  | { type: 'createServer' }
  | { type: 'createChannel'; serverId: string; kind?: 'text' | 'voice'; category?: string }
  | { type: 'invite'; serverId: string }
  | { type: 'serverSettings'; serverId: string; tab?: string }
  | { type: 'userSettings'; tab?: string }
  | { type: 'addToServer'; userId: string }
  | {
      type: 'confirm';
      title: string;
      body: string;
      action: string;
      danger?: boolean;
      onConfirm: () => Promise<unknown> | void;
      /** Pra onde voltar ao cancelar ou concluir (ex.: os ajustes de onde a confirmação saiu). */
      back?: Modal;
    };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
}

interface UiState {
  modal: Modal | null;
  /** `x` é à direita de onde clicou; `flip`, à esquerda — pra quando não couber do outro lado. */
  profile: { userId: string; x: number; y: number; flip: number; serverId?: string } | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  lightbox: Attachment | null;
  palette: boolean;
  drawer: boolean;
  panel: 'pins' | 'search' | null;
  focusOpen: boolean;
  reply: Record<string, ClientMessage | undefined>;
  drafts: Record<string, string>;
  editing: number | null;
  toasts: Toast[];
}

export const useUi = create<UiState>(() => ({
  modal: null,
  profile: null,
  menu: null,
  lightbox: null,
  palette: false,
  drawer: false,
  panel: null,
  focusOpen: false,
  reply: {},
  drafts: {},
  editing: null,
  toasts: [],
}));

export const ui = useUi.setState;
export const openModal = (modal: Modal) => ui({ modal, profile: null, menu: null, palette: false });
export const closeModal = () => ui({ modal: null });

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  ui((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  setTimeout(() => ui((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
}
export const toastError = (e: unknown) => toast(errorText(e), 'error');

export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  ui({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function openProfile(e: { currentTarget: Element; stopPropagation(): void }, userId: string, serverId?: string) {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  ui({ profile: { userId, serverId, x: r.right + 10, y: r.top, flip: r.left - 10 }, menu: null });
}

// ---------- navegação ----------

const LAST_CHANNEL = 'prosa.lastChannel';
const lastChannel: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(LAST_CHANNEL) ?? '{}');
  } catch {
    return {};
  }
})();

export function navigate(path: string, replace = false) {
  if (path !== location.pathname) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  const route = parseRoute(path);
  if (route.page === 'server' && route.channelId) {
    lastChannel[route.serverId] = route.channelId;
    try {
      localStorage.setItem(LAST_CHANNEL, JSON.stringify(lastChannel));
    } catch {
      /* só não lembra da próxima vez */
    }
  }
  const left = currentChannelId();
  set({ route });
  ui({ drawer: false, panel: null, editing: null, profile: null });
  // Saiu do canal: o que estava marcado como "novo" já foi visto.
  if (left && left !== currentChannelId(route) && get().logs[left]?.divider) patchLog(left, () => ({ divider: 0 }));
}
window.addEventListener('popstate', () => navigate(location.pathname, true));

export const goHome = () => navigate('/');
export const goDm = (channelId: string) => navigate('/dm/' + channelId);
export const goChannel = (serverId: string, channelId: string) => navigate(`/s/${serverId}/${channelId}`);

/** Abre o servidor no canal em que a pessoa estava da última vez, ou no primeiro de texto. */
export function goServer(serverId: string, replace = false) {
  const server = get().servers[serverId];
  if (!server) return navigate('/', replace);
  const channel =
    server.channels.find((c) => c.id === lastChannel[serverId]) ?? server.channels.find((c) => c.kind === 'text') ?? server.channels[0];
  navigate(channel ? `/s/${serverId}/${channel.id}` : `/s/${serverId}`, replace);
}

export function currentChannelId(route = get().route): string | null {
  return route.page === 'dm' ? route.channelId : route.page === 'server' ? route.channelId : null;
}

export function findChannel(channelId: string): Channel | undefined {
  const s = get();
  if (s.dms[channelId]) return s.dms[channelId];
  for (const server of Object.values(s.servers)) {
    const found = server.channels.find((c) => c.id === channelId);
    if (found) return found;
  }
  return undefined;
}

// ---------- entrada, saída e carga inicial ----------

function applyBootstrap(data: Bootstrap) {
  set({
    phase: 'ready',
    me: data.me,
    users: Object.fromEntries(data.users.map((u) => [u.id, u])),
    servers: Object.fromEntries(data.servers.map((s) => [s.id, s])),
    serverOrder: data.servers.map((s) => s.id),
    dms: Object.fromEntries(data.dms.map((c) => [c.id, c])),
    friends: Object.fromEntries(data.friends.map((f) => [f.userId, f])),
    unread: data.unread,
    voice: data.voice,
    browsers: Object.fromEntries(data.browsers.map((b) => [b.channelId, b])),
    ice: data.ice,
    features: data.features,
  });
}

let booting = false;
export async function boot() {
  if (!session.token) return set({ phase: 'auth' });
  if (booting) return;
  booting = true;
  try {
    applyBootstrap(await api.get<Bootstrap>('/api/bootstrap'));
    gateway.start();
    fixRoute();
  } catch {
    // Um 401 já derrubou a sessão (e mandou pra tela de entrada); o resto é servidor fora do ar.
    if (session.token) set({ phase: 'error' });
  } finally {
    booting = false;
  }
}

/** Rota que aponta pra algo que não existe mais (servidor apagado, canal removido) volta pro lugar válido mais próximo. */
function fixRoute() {
  const { route, servers, dms } = get();
  if (route.page === 'server') {
    const server = servers[route.serverId];
    if (!server) return navigate('/', true);
    if (!route.channelId || !server.channels.some((c) => c.id === route.channelId)) goServer(server.id, true);
  } else if (route.page === 'dm' && !dms[route.channelId]) navigate('/', true);
}

export async function signIn(token: string) {
  session.set(token);
  set({ phase: 'boot' });
  await boot();
}

export function signOut(callServer = true) {
  if (callServer && session.token) void api.post('/api/auth/logout').catch(() => {});
  gateway.stop();
  session.set(null);
  set({ phase: 'auth', me: null, servers: {}, serverOrder: [], dms: {}, friends: {}, logs: {}, unread: {}, voice: {}, browsers: {}, connected: false });
  ui({ modal: null, profile: null, menu: null, palette: false });
  if (get().route.page !== 'invite') navigate('/', true);
}
session.onExpired = () => signOut(false);

// ---------- mensagens ----------

const emptyLog = (): ChannelLog => ({ list: [], hasMore: true, loaded: false, loading: false, divider: 0 });

function patchLog(channelId: string, fn: (log: ChannelLog) => Partial<ChannelLog>) {
  set((s) => {
    const log = s.logs[channelId] ?? emptyLog();
    return { logs: { ...s.logs, [channelId]: { ...log, ...fn(log) } } };
  });
}

interface Page {
  messages: Message[];
  hasMore: boolean;
  lastRead: number;
}

export async function loadMessages(channelId: string) {
  const log = get().logs[channelId];
  if (log?.loaded || log?.loading) return;
  patchLog(channelId, () => ({ loading: true }));
  try {
    const page = await api.get<Page>(`/api/channels/${channelId}/messages?limit=50`);
    patchLog(channelId, () => ({ list: page.messages, hasMore: page.hasMore, loaded: true, loading: false, divider: page.lastRead }));
  } catch (e) {
    patchLog(channelId, () => ({ loading: false }));
    toastError(e);
  }
}

export async function loadOlder(channelId: string) {
  const log = get().logs[channelId];
  const first = log?.list.find((m) => m.id > 0);
  if (!log?.loaded || log.loading || !log.hasMore || !first) return;
  patchLog(channelId, () => ({ loading: true }));
  try {
    const page = await api.get<Page>(`/api/channels/${channelId}/messages?limit=50&before=${first.id}`);
    patchLog(channelId, (l) => ({ list: [...page.messages, ...l.list], hasMore: page.hasMore, loading: false }));
  } catch (e) {
    patchLog(channelId, () => ({ loading: false }));
    toastError(e);
  }
}

/** Põe a mensagem na lista: troca a de mesmo id, ou a pendente de mesmo nonce, ou entra em ordem. */
function upsert(msg: ClientMessage) {
  const log = get().logs[msg.channelId];
  if (!log?.loaded) return;
  patchLog(msg.channelId, (l) => {
    const index = l.list.findIndex((m) => m.id === msg.id || (!!msg.nonce && m.nonce === msg.nonce));
    // O nonce é a chave da linha na tela: quem substitui herda o da anterior.
    if (index >= 0) return { list: l.list.map((m, i) => (i === index ? { ...msg, nonce: msg.nonce ?? m.nonce } : m)) };
    const firstPending = l.list.findIndex((m) => m.pending || m.failed);
    if (firstPending < 0 || msg.pending) return { list: [...l.list, msg] };
    return { list: [...l.list.slice(0, firstPending), msg, ...l.list.slice(firstPending)] };
  });
}

const makeNonce = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export async function sendMessage(channelId: string, content: string, attachments: Attachment[] = [], reply?: ClientMessage) {
  const me = get().me;
  if (!me) return;
  const nonce = makeNonce();
  upsert({
    id: -Date.now(),
    channelId,
    authorId: me.id,
    content,
    kind: null,
    createdAt: Date.now(),
    editedAt: null,
    pinnedAt: null,
    replyTo: reply ? { id: reply.id, authorId: reply.authorId, content: reply.content.slice(0, 160) } : null,
    attachments,
    reactions: [],
    mentions: [],
    everyone: false,
    nonce,
    pending: true,
  });
  try {
    upsert(await api.post<Message>(`/api/channels/${channelId}/messages`, { content, attachments, replyTo: reply?.id, nonce }));
    patchLog(channelId, () => ({ divider: 0 }));
  } catch (e) {
    patchLog(channelId, (l) => ({ list: l.list.map((m) => (m.nonce === nonce && m.pending ? { ...m, pending: false, failed: true } : m)) }));
    toastError(e);
  }
}

export function discardFailed(channelId: string, nonce: string) {
  patchLog(channelId, (l) => ({ list: l.list.filter((m) => m.nonce !== nonce) }));
}

// ---------- lidas e não lidas ----------

const isLooking = () => document.visibilityState === 'visible' && document.hasFocus();
const isViewing = (channelId: string) => currentChannelId() === channelId && isLooking();

const readTimers = new Map<string, number>();
export function markRead(channelId: string) {
  if (get().unread[channelId]) set((s) => ({ unread: omit(s.unread, channelId) }));
  if (readTimers.has(channelId)) return;
  readTimers.set(
    channelId,
    window.setTimeout(() => {
      readTimers.delete(channelId);
      void api.post(`/api/channels/${channelId}/read`).catch(() => {});
    }, 400),
  );
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = record;
  return rest;
}

// Voltou pra aba com um canal aberto: o que chegou enquanto estava fora passa a contar como lido.
window.addEventListener('focus', () => {
  const channelId = currentChannelId();
  if (channelId && get().unread[channelId]) markRead(channelId);
});

// ---------- eventos do gateway ----------

function setUser(user: User) {
  set((s) => ({ users: { ...s.users, [user.id]: user } }));
}

gateway.on('$connect', () => set({ connected: true }));
gateway.on('$disconnect', () => set({ connected: false }));

// Depois de uma queda: recarrega tudo e busca só o que faltou no canal aberto.
gateway.on('$reconnect', async () => {
  set({ connected: true });
  try {
    applyBootstrap(await api.get<Bootstrap>('/api/bootstrap'));
    fixRoute();
    const open = currentChannelId();
    const logs: Record<string, ChannelLog> = {};
    const log = open ? get().logs[open] : undefined;
    const last = log?.list.findLast((m) => m.id > 0);
    if (open && log?.loaded && last) {
      const page = await api.get<Page>(`/api/channels/${open}/messages?limit=100&after=${last.id}`);
      // Faltou mais do que cabe numa página: melhor recomeçar do fim do que deixar um buraco no meio.
      if (!page.hasMore) logs[open] = { ...log, list: [...log.list.filter((m) => m.id > 0), ...page.messages] };
    }
    set({ logs });
    if (open && !logs[open]) void loadMessages(open);
    if (open && isViewing(open)) markRead(open);
  } catch {
    /* a próxima reconexão tenta de novo */
  }
});

gateway.on('presence', ({ userId, status }: { userId: string; status: Status }) => {
  const user = get().users[userId];
  if (user && user.status !== status) setUser({ ...user, status });
});

gateway.on('user.update', (user: User) => {
  const me = get().me;
  // O próprio status vem "público" (invisível vira offline); o meu de verdade só muda por mim.
  if (me?.id === user.id) set({ me: { ...me, ...user, status: me.status } });
  setUser(user);
});

gateway.on('server.sync', ({ server, users }: { server: Server; users: User[] }) => {
  set((s) => ({
    servers: { ...s.servers, [server.id]: server },
    serverOrder: s.serverOrder.includes(server.id) ? s.serverOrder : [...s.serverOrder, server.id],
    users: { ...s.users, ...Object.fromEntries(users.map((u) => [u.id, u])) },
  }));
  fixRoute();
});

gateway.on('server.delete', ({ id }: { id: string }) => {
  const server = get().servers[id];
  if (!server) return;
  set((s) => ({ servers: omit(s.servers, id), serverOrder: s.serverOrder.filter((x) => x !== id) }));
  const modal = useUi.getState().modal;
  if (modal && 'serverId' in modal && modal.serverId === id) closeModal();
  fixRoute();
});

gateway.on('msg.new', (msg: Message) => {
  const { me, dms, users } = get();
  if (!me) return;
  upsert(msg);
  if (dms[msg.channelId]) set((s) => ({ dms: { ...s.dms, [msg.channelId]: { ...s.dms[msg.channelId], lastId: msg.id } } }));
  set((s) => (s.typing[msg.channelId]?.[msg.authorId] ? { typing: { ...s.typing, [msg.channelId]: omit(s.typing[msg.channelId], msg.authorId) } } : s));
  if (msg.authorId === me.id || msg.kind) return;
  if (isViewing(msg.channelId)) return markRead(msg.channelId);

  const isDm = !!dms[msg.channelId];
  const mentioned = msg.everyone || msg.mentions.includes(me.id);
  // A primeira não lida marca onde a linha de "novas" vai aparecer quando a pessoa voltar.
  if (!get().unread[msg.channelId]) patchLog(msg.channelId, () => ({ divider: msg.id - 1 }));
  set((s) => {
    const prev = s.unread[msg.channelId] ?? { count: 0, mentions: 0 };
    return { unread: { ...s.unread, [msg.channelId]: { count: prev.count + 1, mentions: prev.mentions + (mentioned || isDm ? 1 : 0) } } };
  });
  if (!mentioned && !isDm) return;
  const author = users[msg.authorId] ?? UNKNOWN_USER;
  const channel = findChannel(msg.channelId);
  notifyMessage({
    title: isDm ? author.name : `${author.name} em #${channel?.name ?? 'canal'}`,
    body: msg.content || '📎 anexo',
    icon: author.avatar,
    dm: isDm,
    quiet: me.status === 'dnd',
    onClick: () => (isDm ? goDm(msg.channelId) : channel?.serverId && goChannel(channel.serverId, channel.id)),
  });
});

gateway.on('msg.update', (msg: Message) => upsert(msg));

gateway.on('msg.delete', ({ channelId, id }: { channelId: string; id: number }) => {
  if (get().logs[channelId]) patchLog(channelId, (l) => ({ list: l.list.filter((m) => m.id !== id) }));
});

gateway.on('msg.react', ({ channelId, id, reactions }: Pick<Message, 'channelId' | 'id' | 'reactions'>) => {
  if (get().logs[channelId]) patchLog(channelId, (l) => ({ list: l.list.map((m) => (m.id === id ? { ...m, reactions } : m)) }));
});

gateway.on('read', ({ channelId }: { channelId: string }) => {
  if (get().unread[channelId]) set((s) => ({ unread: omit(s.unread, channelId) }));
});

gateway.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => {
  set((s) => ({ typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [userId]: Date.now() + 6000 } } }));
});
// Quem parou de digitar some da lista sozinho.
setInterval(() => {
  const { typing } = get();
  const now = Date.now();
  let changed = false;
  const next: typeof typing = {};
  for (const [channelId, people] of Object.entries(typing)) {
    const alive = Object.entries(people).filter(([, until]) => until > now);
    if (alive.length !== Object.keys(people).length) changed = true;
    if (alive.length) next[channelId] = Object.fromEntries(alive);
  }
  if (changed) set({ typing: next });
}, 1500);

gateway.on('dm.open', ({ channel, user }: { channel: Channel; user: User }) => {
  set((s) => ({ dms: { ...s.dms, [channel.id]: channel }, users: { ...s.users, [user.id]: user } }));
});

gateway.on('friend.update', ({ friend, user }: { friend: Friend; user: User }) => {
  const before = get().friends[friend.userId];
  set((s) => ({ friends: { ...s.friends, [friend.userId]: friend }, users: { ...s.users, [user.id]: user } }));
  if (friend.status === 'incoming' && !before) {
    toast(`${user.name} quer ser seu amigo.`);
    playSound('message');
  }
});

gateway.on('friend.remove', ({ userId }: { userId: string }) => set((s) => ({ friends: omit(s.friends, userId) })));

gateway.on('voice.state', ({ channelId, userId, state }: { channelId: string; userId: string; state: VoiceState | null }) => {
  // Alguém começou uma chamada numa conversa privada comigo: é uma ligação.
  const { dms, me, voice, users } = get();
  if (state && dms[channelId] && userId !== me?.id && !voice[channelId] && me?.status !== 'dnd') {
    const name = users[userId]?.name ?? 'Alguém';
    toast(`${name} está te ligando.`);
    playSound('done');
    if (!isLooking()) systemNotify(name, 'está te ligando', users[userId]?.avatar, () => goDm(channelId));
  }
  set((s) => {
    const room = state ? { ...s.voice[channelId], [userId]: state } : omit(s.voice[channelId] ?? {}, userId);
    return { voice: Object.keys(room).length ? { ...s.voice, [channelId]: room } : omit(s.voice, channelId) };
  });
});

gateway.on('focus.update', ({ serverId, focus }: { serverId: string; focus: Focus }) => {
  set((s) => (s.servers[serverId] ? { servers: { ...s.servers, [serverId]: { ...s.servers[serverId], focus } } } : s));
});

gateway.on('browser.state', (state: BrowserState & { closed?: boolean }) => {
  set((s) => ({ browsers: state.closed ? omit(s.browsers, state.channelId) : { ...s.browsers, [state.channelId]: state } }));
});

gateway.on('browser.error', ({ error }: { error: string }) => toast(error, 'error'));

// ---------- seletores usados em vários lugares ----------

export const UNKNOWN_USER: User = {
  id: '',
  handle: 'conta.apagada',
  name: 'Conta apagada',
  avatar: null,
  banner: null,
  accent: null,
  bio: '',
  pronouns: '',
  status: 'offline',
  statusText: '',
};

export const useUser = (id: string | null | undefined) => useApp((s) => (id ? s.users[id] : undefined)) ?? UNKNOWN_USER;
export const useMe = () => useApp((s) => s.me)!;

export const useCurrentServer = () => useApp((s) => (s.route.page === 'server' ? s.servers[s.route.serverId] : undefined));

/** Soma das não lidas de um servidor: se há algo novo e quantas menções. */
export function serverUnread(server: Server, unread: Record<string, Unread>): Unread {
  let count = 0;
  let mentions = 0;
  for (const c of server.channels) {
    const u = unread[c.id];
    if (u) {
      count += u.count;
      mentions += u.mentions;
    }
  }
  return { count, mentions };
}

/** Cor do cargo mais alto da pessoa, pra pintar o nome dela no servidor. */
export function roleColor(server: Server | undefined, userId: string): string | undefined {
  const member = server?.members.find((m) => m.userId === userId);
  if (!server || !member?.roles.length) return undefined;
  return server.roles.find((r) => member.roles.includes(r.id))?.color;
}

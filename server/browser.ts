// O navegador da sala: um Chrome/Edge sem janela rodando no servidor, por canal de voz.
// A imagem sai por screencast (JPEG pelo WebSocket) e o mouse e o teclado de quem dirige voltam pelo
// protocolo de depuração (CDP). Não há áudio: o screencast do CDP é só imagem.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { channelAudience, channelRow, features, permsIn } from './core.ts';
import { DATA_DIR } from './db.ts';
import { onRoomEmpty, onRoomLeave, pack, rooms, sendToMany, sendToRoom, type Conn } from './live.ts';
import { isPublicUrl } from './routes/files.ts';
import { P } from '../shared/perms.ts';
import type { BrowserState, DriveMode } from '../shared/types.ts';

const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_INTERVAL = 66; // ~15 quadros por segundo no máximo
const MAX_SESSIONS = Number(process.env.PROSA_BROWSER_MAX ?? 3);
const HOME = 'https://duckduckgo.com/';

const executable =
  process.env.PROSA_BROWSER === 'off'
    ? undefined
    : [
        process.env.BROWSER_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ].find((p) => p && existsSync(p));

features.browser = !!executable;

const sessions = new Map<string, Session>();
export const browserStates = (): BrowserState[] => [...sessions.values()].filter((s) => s.ready).map((s) => s.state);

// Veredito por host, pra não resolver DNS a cada requisição da página.
const hostVerdicts = new Map<string, { ok: boolean; at: number }>();
async function urlAllowed(url: string): Promise<boolean> {
  if (/^(data|blob|about):/i.test(url)) return true;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  const cached = hostVerdicts.get(host);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.ok;
  const ok = await isPublicUrl(url);
  if (hostVerdicts.size > 5000) hostVerdicts.clear();
  hostVerdicts.set(host, { ok, at: Date.now() });
  return ok;
}

/** O que a pessoa digitou na barra vira endereço: URL completa, domínio solto ou busca. */
function toUrl(input: string): string {
  const value = input.trim().slice(0, 2000);
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(value)) return 'https://' + value;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(value);
}

class Session {
  channelId: string;
  serverId: string;
  mode: DriveMode;
  state: BrowserState;
  ready = false;
  closed = false;
  proc: ChildProcess | null = null;
  cdp: WebSocket | null = null;
  page = '';
  mainTarget = '';
  mainFrame = '';
  seq = 0;
  waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  lastFrame: Buffer | null = null;
  lastAck = 0;
  stateTimer: NodeJS.Timeout | null = null;
  mods = new Map<string, { ok: boolean; at: number }>();

  constructor(channelId: string, serverId: string, mode: DriveMode) {
    this.channelId = channelId;
    this.serverId = serverId;
    this.mode = mode;
    this.state = { channelId, url: '', title: '', loading: true, driver: null, queue: [], width: WIDTH, height: HEIGHT };
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.cdp || this.cdp.readyState !== WebSocket.OPEN) return reject(new Error('navegador fechado'));
      const id = ++this.seq;
      this.waiting.set(id, { resolve, reject });
      this.cdp.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  /** Comando na aba principal. Falhas aqui (aba navegando, sessão fechando) não derrubam nada. */
  cmd(method: string, params: object = {}) {
    return this.send(method, params, this.page).catch(() => undefined);
  }

  async start(url: string) {
    const profile = join(DATA_DIR, 'browser', this.serverId);
    mkdirSync(profile, { recursive: true });
    const proc = spawn(
      executable!,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        `--window-size=${WIDTH},${HEIGHT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-sync',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=Translate,MediaRouter',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    this.proc = proc;

    const endpoint = await new Promise<string>((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('o navegador demorou demais pra abrir')), 20_000);
      proc.stderr!.on('data', (chunk: Buffer) => {
        log += chunk.toString();
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(log);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      });
      proc.on('error', reject);
      proc.on('exit', () => {
        clearTimeout(timer);
        reject(new Error('o navegador fechou ao abrir'));
      });
    });
    proc.on('exit', () => this.close());

    const cdp = new WebSocket(endpoint, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    this.cdp = cdp;
    await new Promise<void>((resolve, reject) => {
      cdp.once('open', () => resolve());
      cdp.once('error', reject);
    });
    cdp.on('message', (raw) => this.onMessage(JSON.parse(raw.toString())));
    cdp.on('close', () => this.close());
    cdp.on('error', () => {});

    const { targetInfos } = await this.send('Target.getTargets');
    const target = targetInfos.find((t: any) => t.type === 'page') ?? (await this.send('Target.createTarget', { url: 'about:blank' }));
    this.mainTarget = target.targetId;
    this.page = (await this.send('Target.attachToTarget', { targetId: this.mainTarget, flatten: true })).sessionId;
    await this.send('Target.setDiscoverTargets', { discover: true });
    await this.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    await this.send('Page.enable', {}, this.page);
    this.mainFrame = (await this.send('Page.getFrameTree', {}, this.page)).frameTree.frame.id;
    await this.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, this.page);
    // Toda requisição da página passa pelo guarda (ver onPaused): nada de rede interna.
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, this.page);
    await this.send('Page.startScreencast', { format: 'jpeg', quality: 62, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 }, this.page);
    if (this.closed) throw new Error('navegador fechado');
    this.ready = true;
    void this.navigate(url);
  }

  onMessage(msg: any) {
    if (msg.id) {
      const waiter = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      if (msg.error) waiter?.reject(new Error(msg.error.message));
      else waiter?.resolve(msg.result);
      return;
    }
    const p = msg.params;
    switch (msg.method) {
      case 'Page.screencastFrame': {
        const frame = Buffer.from(p.data, 'base64');
        this.lastFrame = frame;
        const room = rooms.get(this.channelId);
        // Quem está com a fila de envio cheia (rede lenta) pula este quadro em vez de acumular atraso.
        if (room) for (const m of room.values()) if (m.conn.ws.bufferedAmount < 1_500_000) m.conn.ws.send(frame, { binary: true });
        const wait = Math.max(0, FRAME_INTERVAL - (Date.now() - this.lastAck));
        setTimeout(() => {
          this.lastAck = Date.now();
          void this.cmd('Page.screencastFrameAck', { sessionId: p.sessionId });
        }, wait);
        return;
      }
      case 'Fetch.requestPaused':
        void this.onPaused(p);
        return;
      case 'Page.frameStartedLoading':
        if (p.frameId === this.mainFrame) this.patch({ loading: true });
        return;
      case 'Page.frameStoppedLoading':
        if (p.frameId !== this.mainFrame) return;
        this.patch({ loading: false });
        // O título definitivo costuma sair um pouco depois do fim do carregamento.
        void this.refreshInfo();
        setTimeout(() => void this.refreshInfo(), 1200);
        return;
      case 'Page.navigatedWithinDocument':
        // Sites que trocam de página sem recarregar (pushState).
        if (p.frameId === this.mainFrame) {
          this.patch({ url: p.url });
          setTimeout(() => void this.refreshInfo(), 400);
        }
        return;
      case 'Page.javascriptDialogOpening':
        // alert/confirm travariam a página pra todo mundo.
        void this.cmd('Page.handleJavaScriptDialog', { accept: true });
        return;
      case 'Target.targetCreated':
      case 'Target.targetInfoChanged': {
        const info = p.targetInfo;
        if (info.targetId === this.mainTarget) this.patch({ url: info.url, title: info.title });
        else if (info.type === 'page' && /^https?:/i.test(info.url)) {
          // Link que abriria aba nova: a sala tem uma aba só, então ele abre nela.
          void this.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {});
          void this.navigate(info.url);
        }
        return;
      }
    }
  }

  async onPaused(p: any) {
    const ok = await urlAllowed(p.request.url);
    void this.cmd(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: 'BlockedByClient' });
  }

  async navigate(input: string): Promise<boolean> {
    const url = toUrl(input);
    if (!(await urlAllowed(url))) return false;
    this.patch({ loading: true });
    await this.cmd('Page.navigate', { url });
    return true;
  }

  async history(step: -1 | 1) {
    const h = await this.cmd('Page.getNavigationHistory');
    const entry = h?.entries?.[h.currentIndex + step];
    if (entry) await this.cmd('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  /** Relê endereço e título da aba: nem toda mudança de título chega como evento. */
  async refreshInfo() {
    if (this.closed) return;
    const r = await this.send('Target.getTargetInfo', { targetId: this.mainTarget }).catch(() => null);
    if (r?.targetInfo) this.patch({ url: r.targetInfo.url, title: r.targetInfo.title });
  }

  /** Muda o estado e avisa a sala, juntando mudanças próximas num aviso só. */
  patch(change: Partial<BrowserState>) {
    const state = this.state as unknown as Record<string, unknown>;
    if (Object.entries(change).every(([key, value]) => JSON.stringify(state[key]) === JSON.stringify(value))) return;
    Object.assign(this.state, change);
    if (!this.ready || this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (!this.closed) sendToRoom(this.channelId, 'browser.state', this.state);
    }, 60);
  }

  isMod(userId: string): boolean {
    const cached = this.mods.get(userId);
    if (cached && Date.now() - cached.at < 10_000) return cached.ok;
    const ok = ((permsIn(this.serverId, userId) ?? 0) & P.BROWSER) !== 0;
    this.mods.set(userId, { ok, at: Date.now() });
    return ok;
  }

  canDrive(userId: string, take = true): boolean {
    if (this.mode === 'livre') return true;
    if (this.mode === 'poder') return this.isMod(userId);
    // Volante sem dono: quem agir primeiro pega (só passar o mouse por cima não conta).
    if (!this.state.driver && take) this.patch({ driver: userId, queue: this.state.queue.filter((id) => id !== userId) });
    return this.state.driver === userId;
  }

  /** O volante passa pro próximo da fila (ou fica livre). */
  release() {
    const [next, ...rest] = this.state.queue;
    this.patch({ driver: next ?? null, queue: rest });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    sessions.delete(this.channelId);
    for (const w of this.waiting.values()) w.reject(new Error('navegador fechado'));
    this.waiting.clear();
    this.cdp?.close();
    this.proc?.kill();
    if (this.ready) {
      const ch = channelRow(this.channelId);
      if (ch) sendToMany(channelAudience(ch), 'browser.state', { channelId: this.channelId, closed: true });
    }
  }
}

onRoomEmpty.push((channelId) => sessions.get(channelId)?.close());
onRoomLeave.push((channelId, userId) => {
  const s = sessions.get(channelId);
  if (!s) return;
  if (s.state.driver === userId) s.release();
  else if (s.state.queue.includes(userId)) s.patch({ queue: s.state.queue.filter((id) => id !== userId) });
});
process.on('exit', () => {
  for (const s of sessions.values()) s.proc?.kill();
});

/** Quem muda o modo de controle do canal nos ajustes avisa a sessão aberta. */
export function setDriveMode(channelId: string, mode: DriveMode) {
  const s = sessions.get(channelId);
  if (!s) return;
  s.mode = mode;
  s.patch(mode === 'volante' ? {} : { driver: null, queue: [] });
}

/** Quem entra numa sala com navegador aberto recebe o estado e o último quadro na hora. */
export function browserWelcome(conn: Conn, channelId: string) {
  const s = sessions.get(channelId);
  if (!s?.ready) return;
  conn.ws.send(pack('browser.state', s.state));
  if (s.lastFrame) conn.ws.send(s.lastFrame, { binary: true });
}

const MOUSE: Record<string, string> = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased', wheel: 'mouseWheel' };
const BUTTONS = ['left', 'middle', 'right'];
const num = (v: unknown, min: number, max: number) => Math.max(min, Math.min(Number(v) || 0, max));

export async function browserOp(conn: Conn, channelId: string | null, t: string, d: any) {
  if (!channelId) return;
  const { userId } = conn;
  const reply = (error: string) => conn.ws.send(pack('browser.error', { error }));
  const s = sessions.get(channelId);

  if (t === 'browser.open') {
    if (s) return;
    const ch = channelRow(channelId);
    if (!executable) return reply('Este servidor não tem um Chrome ou Edge instalado pra abrir o navegador da sala.');
    if (!ch?.server_id) return reply('O navegador da sala só existe em canais de servidor.');
    if (!((permsIn(ch.server_id, userId) ?? 0) & P.BROWSER)) return reply('Só quem modera o navegador pode abri-lo.');
    if (sessions.size >= MAX_SESSIONS) return reply('Já há navegadores demais abertos neste servidor do Prosa. Tente de novo daqui a pouco.');
    const session = new Session(channelId, ch.server_id, ch.drive_mode);
    sessions.set(channelId, session);
    sendToRoom(channelId, 'browser.opening', { channelId });
    try {
      await session.start(typeof d.url === 'string' && d.url.trim() ? d.url : HOME);
      sendToMany(channelAudience(ch), 'browser.state', session.state);
    } catch (e) {
      console.error('[navegador]', e);
      session.close();
      sendToRoom(channelId, 'browser.state', { channelId, closed: true });
      reply('Não deu pra abrir o navegador da sala.');
    }
    return;
  }

  if (!s?.ready) return;

  switch (t) {
    case 'browser.close':
      if (s.isMod(userId)) s.close();
      else reply('Só quem modera o navegador pode fechá-lo.');
      return;

    case 'browser.nav':
      if (!s.canDrive(userId)) return reply(s.mode === 'poder' ? 'Só quem modera o navegador dirige neste canal.' : 'Outra pessoa está com o volante — peça a vez.');
      if (d.action === 'back') await s.history(-1);
      else if (d.action === 'forward') await s.history(1);
      else if (d.action === 'reload') await s.cmd('Page.reload');
      else if (typeof d.url === 'string' && !(await s.navigate(d.url))) reply('Esse endereço não dá pra abrir na sala.');
      return;

    case 'browser.mouse': {
      const type = MOUSE[d.type];
      if (!type || !s.canDrive(userId, type !== 'mouseMoved')) return;
      const x = num(d.x, 0, 1) * WIDTH;
      const y = num(d.y, 0, 1) * HEIGHT;
      void s.cmd('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: type === 'mouseMoved' || type === 'mouseWheel' ? 'none' : (BUTTONS[d.button] ?? 'left'),
        buttons: num(d.buttons, 0, 7),
        clickCount: type === 'mousePressed' || type === 'mouseReleased' ? num(d.clicks, 1, 3) : 0,
        deltaX: num(d.dx, -2000, 2000),
        deltaY: num(d.dy, -2000, 2000),
        modifiers: num(d.mods, 0, 15),
      });
      // Os outros veem o cursor de quem está mexendo.
      if (type === 'mouseMoved') sendToRoom(channelId, 'browser.cursor', { userId, x: d.x, y: d.y }, userId);
      return;
    }

    case 'browser.key': {
      if (!s.canDrive(userId)) return;
      const text = typeof d.text === 'string' ? d.text.slice(0, 4) : '';
      void s.cmd('Input.dispatchKeyEvent', {
        type: d.type === 'up' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
        key: String(d.key ?? '').slice(0, 32),
        code: String(d.code ?? '').slice(0, 32),
        windowsVirtualKeyCode: num(d.keyCode, 0, 255),
        text: d.type === 'up' ? undefined : text || undefined,
        modifiers: num(d.mods, 0, 15),
      });
      return;
    }

    case 'browser.paste':
      if (s.canDrive(userId) && typeof d.text === 'string') void s.cmd('Input.insertText', { text: d.text.slice(0, 5000) });
      return;

    // O volante: pedir a vez, desistir, soltar, passar pra alguém e (moderação) tomar.
    case 'browser.wheel': {
      if (s.mode !== 'volante') return;
      const { driver, queue } = s.state;
      if (d.action === 'request') {
        if (!driver) s.patch({ driver: userId });
        else if (driver !== userId && !queue.includes(userId)) s.patch({ queue: [...queue, userId] });
      } else if (d.action === 'cancel') s.patch({ queue: queue.filter((id) => id !== userId) });
      else if (d.action === 'release' && driver === userId) s.release();
      else if (d.action === 'take' && s.isMod(userId)) s.patch({ driver: userId, queue: queue.filter((id) => id !== userId) });
      else if (d.action === 'pass' && (driver === userId || s.isMod(userId)) && rooms.get(channelId)?.has(d.userId))
        s.patch({ driver: d.userId, queue: queue.filter((id) => id !== d.userId) });
      return;
    }
  }
}

// Chamada de voz e vídeo: WebRTC direto entre os participantes (malha), com o gateway só de mensageiro.
// Sem servidor de mídia no meio: é leve e roda em qualquer lugar, e vai bem até uma dúzia de pessoas.
//
// Cada par de pessoas tem DUAS conexões de mão única: a minha de envio (só eu oferto nela) e a de
// envio da outra pessoa (só ela oferta). Assim nunca há duas ofertas concorrendo na mesma conexão —
// o que, com uma conexão só de mão dupla, obriga um dos lados a desfazer a oferta (rollback), e o
// Chrome depois disso para de emitir candidatos ICE e a ligação fica muda.
import { create } from 'zustand';
import { gateway } from './gateway';
import { playSound } from './lib/notify';
import { settings, useSettings } from './settings';
import { toast, useApp } from './store';
import type { VoiceState } from '../shared/types';

export interface PeerMedia {
  cam?: MediaStream;
  screen?: MediaStream;
}

interface VoiceStore {
  channelId: string | null;
  status: 'idle' | 'joining' | 'connected';
  muted: boolean;
  deaf: boolean;
  camOn: boolean;
  screenOn: boolean;
  hand: boolean;
  hasMic: boolean;
  /** Tecla de apertar-pra-falar pressionada agora. */
  pttDown: boolean;
  localCam: MediaStream | null;
  localScreen: MediaStream | null;
  media: Record<string, PeerMedia>;
  speaking: Record<string, boolean>;
  /** Como está a ligação com cada pessoa da chamada. */
  links: Record<string, RTCPeerConnectionState>;
  latency: number | null;
  reactions: { id: number; userId: string; emoji: string }[];
}

export const useVoice = create<VoiceStore>(() => ({
  channelId: null,
  status: 'idle',
  muted: false,
  deaf: false,
  camOn: false,
  screenOn: false,
  hand: false,
  hasMic: false,
  pttDown: false,
  localCam: null,
  localScreen: null,
  media: {},
  speaking: {},
  links: {},
  latency: null,
  reactions: [],
}));

const set = useVoice.setState;
const get = useVoice.getState;
const myId = () => useApp.getState().me?.id ?? '';

interface Peer {
  id: string;
  /** Minhas faixas indo pra pessoa. Só eu oferto aqui. */
  out: RTCPeerConnection;
  /** As faixas dela chegando. Só ela oferta; nasce quando a primeira oferta chega. */
  in: RTCPeerConnection | null;
  /** Fila dos sinais recebidos desta pessoa: um de cada vez, na ordem de chegada. */
  queue: Promise<void>;
  streams: Map<string, MediaStream>;
  audios: Map<string, HTMLAudioElement>;
}

/** De qual das conexões de quem manda o sinal ele saiu. */
interface Signal {
  side: 'out' | 'in';
  description?: RTCSessionDescriptionInit | null;
  candidate?: RTCIceCandidateInit;
  restart?: boolean;
}

const peers = new Map<string, Peer>();
let micStream: MediaStream | null = null;
let camStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let mutedBeforeDeaf = false;

// ---------- microfone ----------

function micConstraints(): MediaTrackConstraints {
  const s = settings();
  return {
    deviceId: s.micId ? { exact: s.micId } : undefined,
    noiseSuppression: s.noiseSuppression,
    echoCancellation: s.echoCancellation,
    autoGainControl: s.autoGain,
  };
}

async function openMic(): Promise<MediaStreamTrack | null> {
  try {
    return (await navigator.mediaDevices.getUserMedia({ audio: micConstraints() })).getAudioTracks()[0] ?? null;
  } catch (e) {
    // O aparelho escolhido sumiu (fone desconectado): tenta o padrão antes de desistir.
    if (settings().micId && (e as DOMException).name === 'OverconstrainedError') {
      useSettings.setState({ micId: '' });
      return openMic();
    }
    return null;
  }
}

const micTrack = () => micStream?.getAudioTracks()[0] ?? null;

/** O microfone só transmite se não estiver mudo e, com apertar-pra-falar, se a tecla estiver pressionada. */
function applyMic() {
  const { muted, pttDown } = get();
  const track = micTrack();
  if (track) track.enabled = !muted && (!settings().ptt || pttDown);
}

/** Troca o microfone em uso (novo aparelho ou novos filtros) sem derrubar a chamada. */
export async function refreshMic() {
  if (!micStream || get().status === 'idle') return;
  const fresh = await openMic();
  if (!fresh) return toast('Esse microfone não abriu — fiquei com o anterior.', 'error');
  const old = micTrack();
  // O stream é o mesmo objeto, então o id que os outros conhecem não muda.
  if (old) {
    micStream.removeTrack(old);
    old.stop();
  }
  micStream.addTrack(fresh);
  for (const p of peers.values()) {
    const sender = p.out.getSenders().find((s) => s.track === old);
    if (sender) await sender.replaceTrack(fresh).catch(() => {});
    else p.out.addTrack(fresh, micStream);
  }
  set({ hasMic: true });
  applyMic();
  watchSpeaking();
}

// ---------- detecção de fala ----------

let audioCtx: AudioContext | null = null;
let speakTimer: number | undefined;
let speakSource: MediaStreamAudioSourceNode | null = null;

function watchSpeaking() {
  clearInterval(speakTimer);
  speakSource?.disconnect();
  speakSource = null;
  if (!micStream || !micTrack()) return;
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    speakSource = audioCtx.createMediaStreamSource(micStream);
    speakSource.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let lastLoud = 0;
    speakTimer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const x of samples) sum += x * x;
      const loud = Math.sqrt(sum / samples.length) > 0.018 && !!micTrack()?.enabled;
      if (loud) lastLoud = performance.now();
      // Segura o "falando" por um instante, pra não piscar entre uma sílaba e outra.
      setSpeaking(myId(), performance.now() - lastLoud < 280 && lastLoud > 0, true);
    }, 90);
  } catch {
    /* sem análise de áudio: só não mostra quem fala */
  }
}

function setSpeaking(userId: string, on: boolean, mine = false) {
  if (!!get().speaking[userId] === on) return;
  set((s) => ({ speaking: { ...s.speaking, [userId]: on } }));
  if (mine) gateway.send('voice.speaking', { on });
}

// ---------- conexões ----------

function currentState(): VoiceState {
  const s = get();
  return {
    muted: s.muted || !s.hasMic,
    deaf: s.deaf,
    cam: s.camOn,
    screen: s.screenOn,
    hand: s.hand,
    streams: { mic: micStream?.id, cam: camStream?.id, screen: screenStream?.id },
  };
}

const sendState = () => gateway.send('voice.state', currentState());
const signal = (to: string, data: Signal) => gateway.send('rtc.signal', { to, data });
const newConnection = () => new RTCPeerConnection({ iceServers: useApp.getState().ice });

type SinkAudio = HTMLAudioElement & { setSinkId?(id: string): Promise<void> };

function audioFor(peer: Peer, stream: MediaStream) {
  if (peer.audios.has(stream.id)) return;
  const audio: SinkAudio = new Audio();
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.muted = get().deaf;
  audio.volume = settings().volumes[peer.id] ?? 1;
  const sink = settings().speakerId;
  if (sink) void audio.setSinkId?.(sink).catch(() => {});
  void audio.play().catch(() => {});
  peer.audios.set(stream.id, audio);
}

/** Decide, pelos ids que a pessoa anunciou, qual stream recebido é a câmera e qual é a tela. */
function refreshMedia(peer: Peer) {
  const channelId = get().channelId;
  const state = channelId ? useApp.getState().voice[channelId]?.[peer.id] : undefined;
  for (const stream of peer.streams.values()) if (stream.getAudioTracks().length) audioFor(peer, stream);
  const cam = state?.cam && state.streams.cam ? peer.streams.get(state.streams.cam) : undefined;
  const screen = state?.screen && state.streams.screen ? peer.streams.get(state.streams.screen) : undefined;
  const prev = get().media[peer.id];
  if (prev?.cam !== cam || prev?.screen !== screen) set((s) => ({ media: { ...s.media, [peer.id]: { cam, screen } } }));
}

// Pra mostrar na tela vale a pior das duas ligações; a que nem começou (sem nada pra enviar) não conta.
const LINK_ORDER: RTCPeerConnectionState[] = ['failed', 'disconnected', 'connecting', 'connected'];
function updateLink(peer: Peer) {
  const states = [peer.out.connectionState, peer.in?.connectionState];
  const link = LINK_ORDER.find((s) => states.includes(s)) ?? 'new';
  if (get().links[peer.id] !== link) set((s) => ({ links: { ...s.links, [peer.id]: link } }));
}

function createPeer(id: string): Peer {
  const existing = peers.get(id);
  if (existing) return existing;
  const out = newConnection();
  const peer: Peer = { id, out, in: null, queue: Promise.resolve(), streams: new Map(), audios: new Map() };
  peers.set(id, peer);

  // Dispara sozinho sempre que entra ou sai uma faixa (microfone, câmera, tela).
  out.onnegotiationneeded = async () => {
    try {
      await out.setLocalDescription();
      signal(id, { side: 'out', description: out.localDescription });
    } catch {
      /* a conexão fechou no meio */
    }
  };
  out.onicecandidate = (e) => e.candidate && signal(id, { side: 'out', candidate: e.candidate });
  out.onconnectionstatechange = () => {
    updateLink(peer);
    if (out.connectionState === 'failed') out.restartIce();
  };

  for (const stream of [micStream, camStream, screenStream]) if (stream) for (const track of stream.getTracks()) out.addTrack(track, stream);
  updateLink(peer);
  return peer;
}

function incoming(peer: Peer): RTCPeerConnection {
  if (peer.in) return peer.in;
  const pc = newConnection();
  peer.in = pc;
  pc.onicecandidate = (e) => e.candidate && signal(peer.id, { side: 'in', candidate: e.candidate });
  pc.ontrack = (e) => {
    const stream = e.streams[0];
    if (!stream) return;
    peer.streams.set(stream.id, stream);
    refreshMedia(peer);
  };
  pc.onconnectionstatechange = () => {
    updateLink(peer);
    // Quem recebe não pode ofertar: pede pra quem envia refazer a ligação.
    if (pc.connectionState === 'failed') signal(peer.id, { side: 'in', restart: true });
  };
  return pc;
}

function removePeer(id: string) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  peer.out.close();
  peer.in?.close();
  for (const audio of peer.audios.values()) {
    audio.pause();
    audio.srcObject = null;
  }
  set((s) => {
    const { [id]: _m, ...media } = s.media;
    const { [id]: _l, ...links } = s.links;
    const { [id]: _s, ...speaking } = s.speaking;
    return { media, links, speaking };
  });
}

// Um candidato ICE que chega logo atrás de uma oferta precisa esperar a oferta ser aplicada:
// por isso a fila, em vez de tratar cada sinal assim que chega.
function onSignal({ from, data }: { from: string; data: Signal }) {
  if (get().status === 'idle' || !data) return;
  const peer = createPeer(from);
  peer.queue = peer.queue.then(() => handleSignal(peer, data));
}

async function handleSignal(peer: Peer, data: Signal) {
  if (!peers.has(peer.id)) return;
  try {
    if (data.side === 'out') {
      // Saiu da conexão de envio dela: é pra minha de recebimento.
      const pc = incoming(peer);
      if (data.description) {
        await pc.setRemoteDescription(data.description);
        await pc.setLocalDescription();
        signal(peer.id, { side: 'in', description: pc.localDescription });
      } else if (data.candidate) await pc.addIceCandidate(data.candidate);
    } else if (data.restart) peer.out.restartIce();
    else if (data.description) await peer.out.setRemoteDescription(data.description);
    else if (data.candidate) await peer.out.addIceCandidate(data.candidate);
  } catch (e) {
    console.warn('[voz] sinalização', e);
  }
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Desmonta tudo deste lado. Não avisa o servidor: quem chama decide isso. */
function teardown() {
  for (const id of [...peers.keys()]) removePeer(id);
  clearInterval(speakTimer);
  speakSource?.disconnect();
  speakSource = null;
  stopStream(micStream);
  stopStream(camStream);
  stopStream(screenStream);
  micStream = camStream = screenStream = null;
  set({ channelId: null, status: 'idle', camOn: false, screenOn: false, hand: false, hasMic: false, pttDown: false, localCam: null, localScreen: null, media: {}, speaking: {}, links: {}, reactions: [] });
}

// ---------- ações ----------

export async function joinVoice(channelId: string) {
  const s = get();
  if (s.channelId === channelId || s.status === 'joining') return;
  if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast('Este navegador não faz chamadas (ou a página não está em HTTPS).', 'error');
  if (!gateway.ready) return toast('Sem conexão com o servidor agora. Tente de novo em instantes.', 'error');
  if (s.channelId) leaveVoice(false);
  set({ channelId, status: 'joining' });

  const track = await openMic();
  // A pessoa pode ter desistido (ou trocado de sala) enquanto o navegador pedia permissão.
  if (get().channelId !== channelId) return track?.stop();
  micStream = track ? new MediaStream([track]) : null;
  set({ hasMic: !!track });
  if (!track) toast('Sem microfone: você entrou só ouvindo. Confira a permissão do navegador.', 'error');
  applyMic();
  watchSpeaking();
  gateway.send('voice.join', { channelId, state: currentState() });
}

export function leaveVoice(sound = true) {
  if (get().status === 'idle') return;
  gateway.send('voice.leave');
  teardown();
  if (sound) playSound('leave');
}

export async function toggleMute() {
  const s = get();
  if (!s.hasMic) {
    // Entrou sem microfone: o botão tenta de novo.
    const track = await openMic();
    if (!track) return toast('Não deu pra abrir o microfone. Confira a permissão do navegador.', 'error');
    micStream = new MediaStream([track]);
    for (const p of peers.values()) p.out.addTrack(track, micStream);
    set({ hasMic: true, muted: false });
    watchSpeaking();
  } else set({ muted: !s.muted, ...(s.deaf && s.muted ? { deaf: false } : {}) });
  for (const p of peers.values()) for (const a of p.audios.values()) a.muted = get().deaf;
  applyMic();
  sendState();
  playSound(get().muted ? 'mute' : 'unmute');
}

export function toggleDeaf() {
  const s = get();
  const deaf = !s.deaf;
  // Ensurdecer também cala o microfone; ao voltar, ele retorna ao que era.
  if (deaf) mutedBeforeDeaf = s.muted;
  set({ deaf, muted: deaf ? true : mutedBeforeDeaf });
  for (const p of peers.values()) for (const a of p.audios.values()) a.muted = deaf;
  applyMic();
  sendState();
  playSound(deaf ? 'mute' : 'unmute');
}

function dropStream(stream: MediaStream | null) {
  if (!stream) return;
  const tracks = stream.getTracks();
  for (const p of peers.values()) for (const sender of p.out.getSenders()) if (sender.track && tracks.includes(sender.track)) p.out.removeTrack(sender);
  stopStream(stream);
}

const mediaError = (e: unknown, what: string) => {
  const name = (e as DOMException).name;
  // Fechar o seletor de tela sem escolher nada cai aqui também, e isso não é erro.
  if (name === 'NotAllowedError') return what === 'a tela' ? '' : `Permissão negada pra ${what}.`;
  if (name === 'NotFoundError') return what === 'a câmera' ? 'Nenhuma câmera encontrada.' : `Não achei ${what}.`;
  if (name === 'NotReadableError') return `${what[0].toUpperCase() + what.slice(1)} está em uso por outro programa.`;
  return `Não deu pra ligar ${what}.`;
};

export async function toggleCamera() {
  if (get().status !== 'connected') return;
  if (camStream) {
    dropStream(camStream);
    camStream = null;
    set({ camOn: false, localCam: null });
    return sendState();
  }
  try {
    const camId = settings().camId;
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: camId ? { ideal: camId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  } catch (e) {
    return toast(mediaError(e, 'a câmera'), 'error');
  }
  if (get().status !== 'connected') return stopStream(camStream);
  for (const p of peers.values()) for (const track of camStream.getTracks()) p.out.addTrack(track, camStream);
  set({ camOn: true, localCam: camStream });
  sendState();
}

export async function toggleScreen() {
  if (get().status !== 'connected') return;
  if (screenStream) {
    dropStream(screenStream);
    screenStream = null;
    set({ screenOn: false, localScreen: null });
    return sendState();
  }
  if (!navigator.mediaDevices.getDisplayMedia) return toast('Este navegador não compartilha tela.', 'error');
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
  } catch (e) {
    const message = mediaError(e, 'a tela');
    if (message) toast(message, 'error');
    return;
  }
  if (get().status !== 'connected') return stopStream(screenStream);
  const stream = screenStream;
  // O botão "parar de compartilhar" do próprio navegador encerra por aqui.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => screenStream === stream && void toggleScreen());
  for (const p of peers.values()) for (const track of stream.getTracks()) p.out.addTrack(track, stream);
  set({ screenOn: true, localScreen: stream });
  sendState();
}

export function toggleHand() {
  if (get().status !== 'connected') return;
  set({ hand: !get().hand });
  sendState();
  if (get().hand) playSound('hand');
}

export const sendReaction = (emoji: string) => gateway.send('voice.react', { emoji });

export function setPtt(down: boolean) {
  if (get().pttDown === down || get().status !== 'connected') return;
  set({ pttDown: down });
  applyMic();
}

export function setPeerVolume(userId: string, volume: number) {
  useSettings.setState((s) => ({ volumes: { ...s.volumes, [userId]: volume } }));
  for (const audio of peers.get(userId)?.audios.values() ?? []) audio.volume = volume;
}

// ---------- eventos ----------

gateway.on('voice.joined', ({ channelId, peers: others }: { channelId: string; peers: string[] }) => {
  if (get().channelId !== channelId) return;
  set({ status: 'connected' });
  for (const id of others) createPeer(id);
  playSound('join');
});

gateway.on('voice.state', ({ channelId, userId, state }: { channelId: string; userId: string; state: VoiceState | null }) => {
  if (channelId !== get().channelId || get().status !== 'connected' || userId === myId()) return;
  if (!state) {
    if (peers.has(userId)) playSound('leave');
    return removePeer(userId);
  }
  if (!peers.has(userId)) playSound('join');
  // O estado no useApp é atualizado pelo store no mesmo evento; aqui só relemos as mídias.
  queueMicrotask(() => refreshMedia(createPeer(userId)));
});

gateway.on('rtc.signal', onSignal);
gateway.on('voice.speaking', ({ userId, on }: { userId: string; on: boolean }) => setSpeaking(userId, on));

let reactionId = 0;
gateway.on('voice.react', ({ userId, emoji }: { userId: string; emoji: string }) => {
  const id = ++reactionId;
  set((s) => ({ reactions: [...s.reactions.slice(-11), { id, userId, emoji }] }));
  setTimeout(() => set((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) })), 3200);
});

const KICK_REASON: Record<string, string> = {
  'outra-aba': 'A chamada foi aberta em outro lugar — só um pode ficar nela.',
  removido: 'Tiraram você da chamada.',
  encerrada: 'A chamada foi encerrada.',
  cheia: 'A sala está cheia (12 pessoas).',
};
gateway.on('voice.kicked', ({ reason }: { reason: string }) => {
  if (get().status === 'idle') return;
  teardown();
  toast(KICK_REASON[reason] ?? 'Você saiu da chamada.', 'error');
});

gateway.on('$latency', (ms: number) => set({ latency: ms }));

// A conexão caiu com a chamada aberta: o servidor já tirou a gente da sala. Ao voltar, entra de novo.
gateway.on('$reconnect', () => {
  const { channelId, status } = get();
  if (!channelId || status === 'idle') return;
  for (const id of [...peers.keys()]) removePeer(id);
  set({ status: 'joining' });
  gateway.send('voice.join', { channelId, state: currentState() });
});

// Mudou microfone ou filtros nos ajustes: troca a faixa na hora.
useSettings.subscribe((s, prev) => {
  if (s.micId !== prev.micId || s.noiseSuppression !== prev.noiseSuppression || s.echoCancellation !== prev.echoCancellation || s.autoGain !== prev.autoGain)
    void refreshMic();
  if (s.ptt !== prev.ptt) applyMic();
  if (s.speakerId !== prev.speakerId)
    for (const p of peers.values()) for (const audio of p.audios.values()) void (audio as SinkAudio).setSinkId?.(s.speakerId).catch(() => {});
});

// Fechar a aba no meio da chamada: avisa antes de sair.
window.addEventListener('pagehide', () => get().status !== 'idle' && gateway.send('voice.leave'));

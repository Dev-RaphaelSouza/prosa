// A sala de voz: quem está na chamada, câmeras, telas, o navegador da sala e o chat ao lado.
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Globe,
  Hand,
  HeadphoneOff,
  Headphones,
  LayoutGrid,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Pin,
  Presentation,
  Smile,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { gateway } from '../gateway';
import { plural } from '../lib/format';
import { openProfile, ui, useApp, useMe, useUser } from '../store';
import { joinVoice, leaveVoice, sendReaction, toggleCamera, toggleDeaf, toggleHand, toggleMute, toggleScreen, useVoice } from '../voice';
import { BrowserView } from './BrowserView';
import { ChatBody } from './Chat';
import { Popover } from './Popover';
import { Avatar, Button, IconButton, cx } from './ui';
import { P, permsOf } from '../../shared/perms';
import type { Channel, Server, VoiceState } from '../../shared/types';

const REACTIONS = ['👍', '👏', '😂', '❤️', '🔥', '😮', '🎉', '👀'];

function VideoEl({ stream, mirror, contain }: { stream: MediaStream; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  // Sempre mudo: o áudio de cada pessoa toca por um elemento de áudio próprio, com o volume dela.
  return <video ref={ref} autoPlay playsInline muted className={cx(mirror && 'mirror', contain && 'contain')} />;
}

interface TileProps {
  userId: string;
  state: VoiceState;
  serverId?: string;
  kind: 'person' | 'screen';
  onPin?: () => void;
  pinned?: boolean;
  big?: boolean;
}

const Tile = memo(function Tile({ userId, state, serverId, kind, onPin, pinned, big }: TileProps) {
  const me = useMe();
  const user = useUser(userId);
  const mine = userId === me.id;
  const speaking = useVoice((s) => !!s.speaking[userId]);
  const link = useVoice((s) => s.links[userId]);
  const stream = useVoice((s) => (kind === 'screen' ? (mine ? s.localScreen : s.media[userId]?.screen) : mine ? s.localCam : s.media[userId]?.cam)) ?? null;
  const reaction = useVoice((s) => s.reactions.findLast((r) => r.userId === userId));
  const showVideo = !!stream && (kind === 'screen' ? state.screen : state.cam);

  return (
    <div className={cx('tile', kind, speaking && kind === 'person' && 'speaking', big && 'big')} onDoubleClick={onPin}>
      {showVideo ? (
        <VideoEl stream={stream} mirror={mine && kind === 'person'} contain={kind === 'screen'} />
      ) : (
        <button className="tile-avatar" onClick={(e) => openProfile(e, userId, serverId)} aria-label={`Perfil de ${user.name}`}>
          <Avatar user={user} size={big ? '7rem' : '4.6rem'} />
        </button>
      )}
      <div className="tile-label">
        {kind === 'screen' ? <MonitorUp /> : state.deaf ? <HeadphoneOff className="off" /> : state.muted ? <MicOff className="off" /> : null}
        <span className="truncate">
          {kind === 'screen' ? `Tela de ${user.name}` : user.name}
          {mine && kind === 'person' && ' (você)'}
        </span>
      </div>
      {kind === 'person' && state.hand && (
        <span className="tile-hand" aria-label="Mão levantada">
          <Hand />
        </span>
      )}
      {!mine && (link === 'connecting' || link === 'disconnected' || link === 'failed') && (
        <span className="tile-link">{link === 'failed' ? 'sem conexão' : link === 'disconnected' ? 'instável' : 'conectando…'}</span>
      )}
      {onPin && (
        <IconButton label={pinned ? 'Tirar do destaque' : 'Pôr em destaque'} className="tile-pin" on={pinned} onClick={onPin}>
          <Pin />
        </IconButton>
      )}
      {reaction && kind === 'person' && (
        <span key={reaction.id} className="tile-reaction">
          {reaction.emoji}
        </span>
      )}
    </div>
  );
});

function Lobby({ channel, server }: { channel: Channel; server?: Server }) {
  const room = useApp((s) => s.voice[channel.id]);
  const users = useApp((s) => s.users);
  const elsewhere = useVoice((s) => !!s.channelId && s.channelId !== channel.id);
  const joining = useVoice((s) => s.status === 'joining');
  const browser = useApp((s) => !!s.browsers[channel.id]);
  const ids = Object.keys(room ?? {});

  return (
    <div className="lobby">
      <span className="lobby-icon">
        <Volume2 />
      </span>
      <h2>{channel.kind === 'dm' ? 'Chamada' : channel.name}</h2>
      {channel.topic && <p className="muted">{channel.topic}</p>}
      {ids.length > 0 ? (
        <>
          <div className="lobby-people">
            {ids.slice(0, 8).map((id) => users[id] && <Avatar key={id} user={users[id]} size="2.6rem" />)}
            {ids.length > 8 && <span className="lobby-more">+{ids.length - 8}</span>}
          </div>
          <p className="muted">
            {ids.length === 1 ? `${users[ids[0]]?.name ?? 'Alguém'} está na chamada` : `${plural(ids.length, 'pessoa', 'pessoas')} na chamada`}
            {browser && ' · com o navegador da sala aberto'}
          </p>
        </>
      ) : (
        <p className="muted">Ninguém por aqui ainda. Entre e chame o pessoal.</p>
      )}
      <Button variant="primary" loading={joining} autoFocus onClick={() => joinVoice(channel.id)}>
        <Mic /> Entrar na chamada
      </Button>
      {elsewhere && <p className="hint">Você está em outra chamada: entrar aqui sai de lá.</p>}
      {server && <p className="hint">Dica: dois cliques no canal, na lista, entram direto.</p>}
    </div>
  );
}

export function CallControls({ channel, server, chatOpen, onChat }: { channel: Channel; server?: Server; chatOpen?: boolean; onChat?: () => void }) {
  const me = useMe();
  const v = useVoice();
  const browserOpen = useApp((s) => !!s.browsers[channel.id]);
  const canBrowse = useApp((s) => s.features.browser) && !!server && (permsOf(server, me.id) & P.BROWSER) !== 0;
  const unread = useApp((s) => s.unread[channel.id]?.count ?? 0);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const micOff = v.muted || !v.hasMic;

  return (
    <div className="controls">
      <IconButton label={micOff ? 'Ligar o microfone' : 'Desligar o microfone'} className="ctl" off={micOff} onClick={toggleMute}>
        {micOff ? <MicOff /> : <Mic />}
      </IconButton>
      <IconButton label={v.deaf ? 'Ligar o som da sala' : 'Desligar o som da sala'} className="ctl" off={v.deaf} onClick={toggleDeaf}>
        {v.deaf ? <HeadphoneOff /> : <Headphones />}
      </IconButton>
      <IconButton label={v.camOn ? 'Desligar a câmera' : 'Ligar a câmera'} className="ctl" on={v.camOn} onClick={toggleCamera}>
        {v.camOn ? <Video /> : <VideoOff />}
      </IconButton>
      <IconButton label={v.screenOn ? 'Parar de compartilhar' : 'Compartilhar a tela'} className="ctl" on={v.screenOn} onClick={toggleScreen}>
        <MonitorUp />
      </IconButton>
      {(canBrowse || browserOpen) && (
        <IconButton
          label={browserOpen ? 'Navegador da sala aberto' : 'Abrir o navegador da sala'}
          className="ctl"
          on={browserOpen}
          disabled={browserOpen && !canBrowse}
          onClick={() => gateway.send(browserOpen ? 'browser.close' : 'browser.open', {})}
        >
          <Globe />
        </IconButton>
      )}
      <span className="controls-sep" />
      <IconButton label={v.hand ? 'Baixar a mão' : 'Levantar a mão'} className="ctl" on={v.hand} onClick={toggleHand}>
        <Hand />
      </IconButton>
      <IconButton label="Reagir" className="ctl" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
        <Smile />
      </IconButton>
      {onChat && (
        <IconButton label={chatOpen ? 'Esconder o chat' : 'Mostrar o chat'} className="ctl" on={chatOpen} onClick={onChat}>
          <MessageSquare />
          {!chatOpen && unread > 0 && <span className="ctl-dot" />}
        </IconButton>
      )}
      <span className="controls-sep" />
      <IconButton label="Sair da chamada" className="ctl hangup" onClick={() => leaveVoice()}>
        <PhoneOff />
      </IconButton>
      {picker && (
        <Popover anchor={picker} onClose={() => setPicker(null)} className="reaction-bar">
          {REACTIONS.map((emoji) => (
            <button key={emoji} onClick={() => sendReaction(emoji)} aria-label={`Reagir com ${emoji}`}>
              {emoji}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

/** As peças da chamada (destaque + participantes). `compact` é a versão embutida na conversa privada. */
export function CallView({ channel, server, compact }: { channel: Channel; server?: Server; compact?: boolean }) {
  const me = useMe();
  const room = useApp((s) => s.voice[channel.id]);
  const browser = useApp((s) => s.browsers[channel.id]);
  const [pin, setPin] = useState<string | null>(null);
  const [grid, setGrid] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => gateway.on('browser.opening', () => setOpening(true)), []);
  useEffect(() => {
    if (!opening) return;
    // Abriu, ou falhou e o servidor avisou: em qualquer caso o aviso de "abrindo" sai.
    if (browser) return setOpening(false);
    const off = gateway.on('browser.error', () => setOpening(false));
    const timer = setTimeout(() => setOpening(false), 30_000);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [opening, browser]);

  const entries = Object.entries(room ?? {});
  // Eu sempre primeiro; os outros na ordem de chegada.
  entries.sort(([a], [b]) => Number(b === me.id) - Number(a === me.id));
  const screens = entries.filter(([, s]) => s.screen);

  // O que pode ir pro destaque: o navegador, cada tela compartilhada, ou uma pessoa fixada.
  const options = [...(browser && server ? ['browser'] : []), ...screens.map(([id]) => 'screen:' + id)];
  const spot = pin && (options.includes(pin) || (pin.startsWith('person:') && room?.[pin.slice(7)])) ? pin : (options[0] ?? null);
  const showSpot = !!spot && !grid;
  const toggle = (key: string) => {
    setGrid(false);
    setPin(spot === key && !grid ? null : key);
  };

  const people = entries.map(([id, state]) => (
    <Tile key={id} userId={id} state={state} serverId={server?.id} kind="person" onPin={entries.length > 1 || options.length ? () => toggle('person:' + id) : undefined} pinned={showSpot && spot === 'person:' + id} />
  ));
  const layoutButton = (className: string) =>
    options.length > 0 &&
    !compact && (
      <button className={className} onClick={() => setGrid(!grid)} data-tip={grid ? 'Voltar pro destaque' : 'Ver todos em grade'} data-tip-pos="left" aria-label={grid ? 'Voltar pro destaque' : 'Ver todos em grade'}>
        {grid ? <Presentation /> : <LayoutGrid />}
      </button>
    );

  return (
    <div className={cx('call', compact && 'compact')}>
      {opening && !browser && (
        <div className="call-notice">
          <span className="spinner" /> Abrindo o navegador da sala…
        </div>
      )}
      {showSpot ? (
        <>
          <div className="spot">
            {spot === 'browser' && browser && server ? (
              <BrowserView channel={channel} server={server} state={browser} />
            ) : spot.startsWith('screen:') ? (
              <Tile userId={spot.slice(7)} state={room![spot.slice(7)]} serverId={server?.id} kind="screen" big />
            ) : (
              <Tile userId={spot.slice(7)} state={room![spot.slice(7)]} serverId={server?.id} kind="person" big onPin={() => setPin(null)} pinned />
            )}
          </div>
          <div className="filmstrip">
            {browser && server && spot !== 'browser' && (
              <button className="tile strip-item" onClick={() => toggle('browser')}>
                <Globe />
                <span className="tile-label">Navegador da sala</span>
              </button>
            )}
            {screens
              .filter(([id]) => spot !== 'screen:' + id)
              .map(([id, state]) => (
                <Tile key={'s' + id} userId={id} state={state} serverId={server?.id} kind="screen" onPin={() => toggle('screen:' + id)} />
              ))}
            {people}
            {layoutButton('strip-layout')}
          </div>
        </>
      ) : (
        <>
          <TileGrid count={entries.length + screens.length}>
            {screens.map(([id, state]) => (
              <Tile key={'s' + id} userId={id} state={state} serverId={server?.id} kind="screen" onPin={() => toggle('screen:' + id)} />
            ))}
            {people}
          </TileGrid>
          {layoutButton('call-layout')}
        </>
      )}
    </div>
  );
}

/** A grade de participantes: escolhe quantas colunas deixam os quadros 16:9 maiores no espaço que há. */
function TileGrid({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const GAP = 10;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      let best = { w: 0, h: 0 };
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        let w = (width - GAP * (cols - 1)) / cols;
        let h = (w * 9) / 16;
        const maxH = (height - GAP * (rows - 1)) / rows;
        if (h > maxH) {
          h = maxH;
          w = (h * 16) / 9;
        }
        if (w * h > best.w * best.h) best = { w: Math.floor(w), h: Math.floor(h) };
      }
      setSize((prev) => (prev.w === best.w && prev.h === best.h ? prev : best));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);

  return (
    <div className="tiles" ref={ref} style={{ '--tw': size.w + 'px', '--th': size.h + 'px' } as CSSProperties}>
      {size.w > 0 && children}
    </div>
  );
}

/** A chamada dentro de uma conversa privada: fica em cima das mensagens. */
export function DmCall({ channel }: { channel: Channel }) {
  const status = useVoice((s) => (s.channelId === channel.id ? s.status : 'idle'));
  const other = useUser(channel.recipientId);
  if (status !== 'connected')
    return (
      <div className="dm-call-banner">
        <Phone />
        <span className="grow truncate">
          <b>{other.name}</b> está na chamada.
        </span>
        <Button small variant="primary" loading={status === 'joining'} onClick={() => joinVoice(channel.id)}>
          Entrar
        </Button>
      </div>
    );
  return (
    <div className="dm-call">
      <CallView channel={channel} compact />
      <CallControls channel={channel} />
    </div>
  );
}

export default function Stage({ channel, server }: { channel: Channel; server: Server }) {
  const connected = useVoice((s) => s.channelId === channel.id && s.status === 'connected');
  const count = useApp((s) => Object.keys(s.voice[channel.id] ?? {}).length);
  const [chatOpen, setChatOpen] = useState(() => innerWidth > 1100);

  return (
    <main className="main stage">
      <header className="main-head">
        <IconButton label="Abrir servidores e canais" className="only-mobile" tip="bottom" onClick={() => ui({ drawer: true })}>
          <Menu />
        </IconButton>
        <div className="row head-title">
          <Volume2 className="head-icon" />
          <b className="truncate">{channel.name}</b>
        </div>
        {channel.topic && <span className="head-topic truncate">{channel.topic}</span>}
        <span className="grow" />
        {count > 0 && <span className="muted head-count">{plural(count, 'pessoa', 'pessoas')}</span>}
        <IconButton label={chatOpen ? 'Esconder o chat' : 'Mostrar o chat'} tip="left" on={chatOpen} onClick={() => setChatOpen(!chatOpen)}>
          <MessageSquare />
        </IconButton>
      </header>
      <div className="main-row">
        <div className="stage-main">
          {connected ? (
            <>
              <CallView channel={channel} server={server} />
              <CallControls channel={channel} server={server} chatOpen={chatOpen} onChat={() => setChatOpen(!chatOpen)} />
            </>
          ) : (
            <Lobby channel={channel} server={server} />
          )}
        </div>
        {chatOpen && (
          <aside className="stage-chat">
            <ChatBody channel={channel} server={server} />
          </aside>
        )}
      </div>
    </main>
  );
}

// A segunda coluna: canais do servidor (ou conversas privadas), a barra da chamada e o painel da pessoa.
import { memo, useState } from 'react';
import {
  ChevronDown,
  Globe,
  Hand,
  Hash,
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  Settings,
  Signal,
  Timer,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { api } from '../api';
import { channelMenu, copyInvite, serverMenu } from '../actions';
import { STATUS_LABEL, formatClock } from '../lib/format';
import { useNow } from '../lib/hooks';
import {
  findChannel,
  goChannel,
  goDm,
  goHome,
  openMenu,
  openModal,
  openProfile,
  toastError,
  ui,
  useApp,
  useMe,
  useUi,
  useUser,
} from '../store';
import { joinVoice, leaveVoice, toggleCamera, toggleDeaf, toggleMute, toggleScreen, useVoice } from '../voice';
import { Avatar, IconButton, cx } from './ui';
import { P, permsOf } from '../../shared/perms';
import type { Channel, Server, Status, VoiceState } from '../../shared/types';

const count = (n: number) => (n > 99 ? '99+' : n);

// ---------- canais do servidor ----------

const VoiceMember = memo(function VoiceMember({ userId, state, serverId, live }: { userId: string; state: VoiceState; serverId: string; live: boolean }) {
  const user = useUser(userId);
  const speaking = useVoice((s) => live && !!s.speaking[userId]);
  return (
    <button className="voice-member" onClick={(e) => openProfile(e, userId, serverId)}>
      <Avatar user={user} size="1.5rem" speaking={speaking} />
      <span className="grow truncate">{user.name}</span>
      {state.hand && <Hand className="warn" />}
      {state.screen && <MonitorUp className="live" />}
      {state.cam && <Video />}
      {state.deaf ? <HeadphoneOff className="off" /> : state.muted && <MicOff className="off" />}
    </button>
  );
});

const ChannelItem = memo(function ChannelItem({ server, channel, active }: { server: Server; channel: Channel; active: boolean }) {
  const unread = useApp((s) => s.unread[channel.id]);
  const room = useApp((s) => s.voice[channel.id]);
  const browser = useApp((s) => !!s.browsers[channel.id]);
  const live = useVoice((s) => s.channelId === channel.id);
  const voice = channel.kind === 'voice';
  const people = room ? Object.entries(room) : [];

  return (
    <>
      <button
        className={cx('chan', active && 'active', !active && unread && 'unread', live && 'live')}
        onClick={() => goChannel(server.id, channel.id)}
        onDoubleClick={() => voice && void joinVoice(channel.id)}
        onContextMenu={(e) => openMenu(e, channelMenu(server, channel))}
        title={channel.topic || undefined}
      >
        {voice ? <Volume2 /> : <Hash />}
        <span className="grow truncate">{channel.name}</span>
        {browser && <Globe className="chan-extra" />}
        {voice && people.length > 0 && <span className="chan-count">{people.length}</span>}
        {!active && unread && (unread.mentions > 0 ? <span className="badge">{count(unread.mentions)}</span> : <span className="unread-dot" />)}
      </button>
      {voice && people.length > 0 && (
        <div className="voice-members">
          {people.map(([userId, state]) => (
            <VoiceMember key={userId} userId={userId} state={state} serverId={server.id} live={live} />
          ))}
        </div>
      )}
    </>
  );
});

function FocusChip({ server }: { server: Server }) {
  const now = useNow(server.focus.phase !== 'idle');
  const { phase, endsAt } = server.focus;
  if (phase === 'idle' || !endsAt) return null;
  const left = endsAt - now;
  return (
    <button className={cx('focus-chip', phase)} onClick={() => ui({ focusOpen: true })}>
      <Timer />
      <span>{phase === 'foco' ? 'Foco' : 'Pausa'}</span>
      <b>{left > 0 ? formatClock(left) : 'acabou'}</b>
    </button>
  );
}

function ServerSidebar({ server }: { server: Server }) {
  const me = useMe();
  const activeId = useApp((s) => (s.route.page === 'server' ? s.route.channelId : null));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const perms = permsOf(server, me.id);
  const canManage = (perms & P.MANAGE_CHANNELS) !== 0;

  // Categorias na ordem em que aparecem; canal sem categoria vai no topo, sem cabeçalho.
  const groups: { name: string; channels: Channel[] }[] = [];
  for (const channel of server.channels) {
    let group = groups.find((g) => g.name === channel.category);
    if (!group) groups.push((group = { name: channel.category, channels: [] }));
    group.channels.push(channel);
  }
  groups.sort((a, b) => (a.name === '' ? -1 : b.name === '' ? 1 : 0));

  return (
    <>
      <header className="side-head">
        <button
          className="side-title"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu({ clientX: r.left + 8, clientY: r.bottom + 6, preventDefault() {}, stopPropagation() {} }, serverMenu(server));
          }}
        >
          <span className="grow truncate">{server.name}</span>
          <ChevronDown />
        </button>
        <IconButton label="Sessão de foco" tip="bottom" onClick={() => ui((s) => ({ focusOpen: !s.focusOpen }))}>
          <Timer />
        </IconButton>
        {(perms & P.INVITE) !== 0 && (
          <IconButton label="Copiar link de convite" tip="bottom" onClick={() => copyInvite(server.id)}>
            <UserPlus />
          </IconButton>
        )}
      </header>

      <div className="side-scroll">
        <FocusChip server={server} />
        {server.channels.length === 0 && (
          <div className="side-empty">
            <p>Ainda não há canais por aqui.</p>
            {canManage && (
              <button className="btn primary small" onClick={() => openModal({ type: 'createChannel', serverId: server.id })}>
                Criar o primeiro canal
              </button>
            )}
          </div>
        )}
        {groups.map((group) => (
          <section key={group.name}>
            {group.name && (
              <div className="cat">
                <button className="cat-toggle" onClick={() => setCollapsed((c) => ({ ...c, [group.name]: !c[group.name] }))} aria-expanded={!collapsed[group.name]}>
                  <ChevronDown className={cx(collapsed[group.name] && 'closed')} />
                  <span className="truncate">{group.name}</span>
                </button>
                {canManage && (
                  <button className="cat-add" aria-label={`Novo canal em ${group.name}`} data-tip="Criar canal" onClick={() => openModal({ type: 'createChannel', serverId: server.id, category: group.name })}>
                    <Plus />
                  </button>
                )}
              </div>
            )}
            {group.channels.map((channel) => {
              const active = channel.id === activeId;
              // Categoria recolhida ainda mostra o canal aberto: a pessoa não se perde.
              if (collapsed[group.name] && !active) return null;
              return <ChannelItem key={channel.id} server={server} channel={channel} active={active} />;
            })}
          </section>
        ))}
      </div>
    </>
  );
}

// ---------- conversas privadas ----------

const DmItem = memo(function DmItem({ channel, active }: { channel: Channel; active: boolean }) {
  const user = useUser(channel.recipientId);
  const unread = useApp((s) => s.unread[channel.id]?.count ?? 0);
  const inCall = useApp((s) => !!s.voice[channel.id]);
  return (
    <button className={cx('chan dm', active && 'active', !active && unread > 0 && 'unread')} onClick={() => goDm(channel.id)}>
      <Avatar user={user} size="2rem" status={user.status} />
      <span className="grow dm-names">
        <span className="truncate">{user.name}</span>
        {(inCall || user.statusText) && <small className="truncate">{inCall ? 'Em chamada' : user.statusText}</small>}
      </span>
      {!active && unread > 0 && <span className="badge">{count(unread)}</span>}
    </button>
  );
});

function HomeSidebar() {
  const dms = useApp((s) => s.dms);
  const route = useApp((s) => s.route);
  const pending = useApp((s) => Object.values(s.friends).filter((f) => f.status === 'incoming').length);
  const list = Object.values(dms).sort((a, b) => (b.lastId ?? 0) - (a.lastId ?? 0));
  return (
    <>
      <header className="side-head">
        <span className="side-title static">Mensagens</span>
      </header>
      <div className="side-scroll">
        <button className={cx('chan', route.page === 'home' && 'active')} onClick={goHome}>
          <Users />
          <span className="grow">Amigos</span>
          {pending > 0 && <span className="badge">{count(pending)}</span>}
        </button>
        <div className="cat">
          <span className="cat-toggle">Conversas</span>
        </div>
        {list.length === 0 && <p className="side-empty">Quando você conversar em privado com alguém, a conversa fica aqui.</p>}
        {list.map((c) => (
          <DmItem key={c.id} channel={c} active={route.page === 'dm' && route.channelId === c.id} />
        ))}
      </div>
    </>
  );
}

// ---------- chamada em andamento ----------

function CallBar() {
  const v = useVoice();
  if (!v.channelId) return null;
  const channel = findChannel(v.channelId);
  const state = useApp.getState();
  const server = channel?.serverId ? state.servers[channel.serverId] : undefined;
  const name = channel?.kind === 'dm' ? (state.users[channel.recipientId ?? '']?.name ?? 'Conversa') : (channel?.name ?? 'Chamada');
  const quality = v.latency === null ? '' : v.latency < 120 ? 'good' : v.latency < 300 ? 'fair' : 'bad';

  return (
    <div className="callbar">
      <div className="callbar-info">
        <Signal className={cx('signal', quality)} />
        <button className="grow callbar-where" onClick={() => channel && (channel.serverId ? goChannel(channel.serverId, channel.id) : goDm(channel.id))}>
          <b>{v.status === 'joining' ? 'Entrando…' : 'Voz conectada'}</b>
          <small className="truncate">
            {name}
            {server ? ` · ${server.name}` : ''}
            {v.latency !== null ? ` · ${v.latency} ms` : ''}
          </small>
        </button>
        <IconButton label="Sair da chamada" className="hangup" onClick={() => leaveVoice()}>
          <PhoneOff />
        </IconButton>
      </div>
      <div className="callbar-actions">
        <IconButton label={v.muted || !v.hasMic ? 'Ligar o microfone' : 'Desligar o microfone'} off={v.muted || !v.hasMic} onClick={toggleMute}>
          {v.muted || !v.hasMic ? <MicOff /> : <Mic />}
        </IconButton>
        <IconButton label={v.deaf ? 'Ligar o som' : 'Desligar o som'} off={v.deaf} onClick={toggleDeaf}>
          {v.deaf ? <HeadphoneOff /> : <Headphones />}
        </IconButton>
        <IconButton label={v.camOn ? 'Desligar a câmera' : 'Ligar a câmera'} on={v.camOn} onClick={toggleCamera}>
          {v.camOn ? <Video /> : <VideoOff />}
        </IconButton>
        <IconButton label={v.screenOn ? 'Parar de compartilhar' : 'Compartilhar a tela'} on={v.screenOn} onClick={toggleScreen}>
          <MonitorUp />
        </IconButton>
      </div>
    </div>
  );
}

// ---------- painel da pessoa ----------

const STATUSES: Status[] = ['online', 'idle', 'dnd', 'invisible'];

function UserPanel() {
  const me = useMe();
  const setStatus = (status: Status) =>
    api
      .patch('/api/me', { status })
      .then(() => useApp.setState((s) => ({ me: s.me && { ...s.me, status } })))
      .catch(toastError);

  return (
    <div className="userpanel">
      <button
        className="userpanel-me"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          openMenu({ clientX: r.left, clientY: r.top - 8, preventDefault() {}, stopPropagation() {} }, [
            ...STATUSES.map((status) => ({
              label: STATUS_LABEL[status],
              icon: <span className={'status-dot static ' + status} />,
              onSelect: () => setStatus(status),
            })),
            { label: '', separator: true },
            { label: 'Editar perfil', icon: <Settings />, onSelect: () => openModal({ type: 'userSettings', tab: 'perfil' }) },
          ]);
        }}
      >
        <Avatar user={me} size="2.1rem" status={me.status} ring="var(--bg-0)" />
        <span className="grow dm-names">
          <span className="truncate">{me.name}</span>
          <small className="truncate">{me.statusText || STATUS_LABEL[me.status]}</small>
        </span>
      </button>
      <IconButton label="Ajustes" onClick={() => openModal({ type: 'userSettings' })}>
        <Settings />
      </IconButton>
    </div>
  );
}

export function Sidebar() {
  const server = useApp((s) => (s.route.page === 'server' ? s.servers[s.route.serverId] : undefined));
  const drawer = useUi((s) => s.drawer);
  return (
    <aside className={cx('sidebar', drawer && 'open')}>
      {server ? <ServerSidebar server={server} /> : <HomeSidebar />}
      <CallBar />
      <UserPanel />
    </aside>
  );
}

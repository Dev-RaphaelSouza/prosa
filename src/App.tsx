import { Suspense, lazy, useEffect } from 'react';
import { Hash, Menu, WifiOff } from 'lucide-react';
import { Auth, InviteScreen } from './components/Auth';
import { ChatBody, ChatHeader, ChatPanels } from './components/Chat';
import { FocusPanel, FocusWatcher } from './components/Focus';
import { Friends } from './components/Friends';
import { ConfirmModal, Lightbox, MenuLayer, Toasts } from './components/Layers';
import { Members } from './components/Members';
import { AddToServerModal, CreateChannelModal, CreateServerModal, InviteModal } from './components/Modals';
import { Palette } from './components/Palette';
import { ProfileCard } from './components/ProfileCard';
import { Rail } from './components/Rail';
import { Sidebar } from './components/Sidebar';
import { Button, IconButton, Logo, cx } from './components/ui';
import { useTheme } from './lib/theme';
import { useSettings } from './settings';
import { boot, openModal, ui, useApp, useUi } from './store';
import { useVoice } from './voice';
import type { Channel, Server } from '../shared/types';

// O que nem toda sessão usa fica fora do pacote inicial e só baixa quando abre.
const Stage = lazy(() => import('./components/Stage'));
const DmCall = lazy(() => import('./components/Stage').then((m) => ({ default: m.DmCall })));
const UserSettings = lazy(() => import('./components/settings/UserSettings'));
const ServerSettings = lazy(() => import('./components/settings/ServerSettings'));

function Splash({ text }: { text?: string }) {
  return (
    <div className="splash">
      <Logo size={56} />
      {text ? <p>{text}</p> : <span className="spinner" />}
    </div>
  );
}

function ModalHost() {
  const modal = useUi((s) => s.modal);
  if (!modal) return null;
  switch (modal.type) {
    case 'createServer':
      return <CreateServerModal />;
    case 'createChannel':
      return <CreateChannelModal modal={modal} />;
    case 'invite':
      return <InviteModal modal={modal} />;
    case 'addToServer':
      return <AddToServerModal modal={modal} />;
    case 'confirm':
      return <ConfirmModal modal={modal} />;
    case 'userSettings':
      return <UserSettings modal={modal} />;
    case 'serverSettings':
      return <ServerSettings modal={modal} />;
  }
}

function TextChannel({ channel, server }: { channel: Channel; server: Server }) {
  const membersOpen = useSettings((s) => s.membersOpen);
  return (
    <main className="main">
      <ChatHeader channel={channel} server={server} />
      <div className="main-row">
        <ChatBody channel={channel} server={server} />
        <ChatPanels channel={channel} server={server} />
        {membersOpen && <Members server={server} />}
      </div>
    </main>
  );
}

function DmChannel({ channel }: { channel: Channel }) {
  // Com chamada em andamento (minha ou da outra pessoa), ela aparece em cima da conversa.
  const ringing = useApp((s) => !!s.voice[channel.id]);
  const mine = useVoice((s) => s.channelId === channel.id);
  const active = ringing || mine;
  return (
    <main className="main">
      <ChatHeader channel={channel} />
      {active && <DmCall channel={channel} />}
      <div className="main-row">
        <ChatBody channel={channel} />
        <ChatPanels channel={channel} />
      </div>
    </main>
  );
}

function EmptyServer({ server }: { server: Server }) {
  return (
    <main className="main">
      <header className="main-head">
        <IconButton label="Abrir servidores e canais" className="only-mobile" tip="bottom" onClick={() => ui({ drawer: true })}>
          <Menu />
        </IconButton>
        <b>{server.name}</b>
      </header>
      <div className="empty">
        <Hash />
        <h3>Nenhum canal por aqui</h3>
        <p>Este servidor ainda está vazio. Quem pode gerenciar canais cria o primeiro.</p>
        <Button variant="primary" onClick={() => openModal({ type: 'createChannel', serverId: server.id })}>
          Criar canal
        </Button>
      </div>
    </main>
  );
}

function Content() {
  const route = useApp((s) => s.route);
  const server = useApp((s) => (s.route.page === 'server' ? s.servers[s.route.serverId] : undefined));
  const dm = useApp((s) => (s.route.page === 'dm' ? s.dms[s.route.channelId] : undefined));

  if (route.page === 'dm' && dm) return <DmChannel key={dm.id} channel={dm} />;
  if (route.page === 'server' && server) {
    const channel = server.channels.find((c) => c.id === route.channelId);
    if (!channel) return <EmptyServer server={server} />;
    return channel.kind === 'voice' ? <Stage key={channel.id} channel={channel} server={server} /> : <TextChannel channel={channel} server={server} />;
  }
  return <Friends />;
}

/** O número de menções e mensagens privadas não lidas aparece no título da aba. */
function useTitleBadge() {
  const total = useApp((s) => Object.values(s.unread).reduce((sum, u) => sum + u.mentions, 0));
  useEffect(() => {
    document.title = total > 0 ? `(${total > 99 ? '99+' : total}) Prosa` : 'Prosa';
  }, [total]);
}

function Shell() {
  const drawer = useUi((s) => s.drawer);
  const connected = useApp((s) => s.connected);
  useTitleBadge();
  return (
    <div className={cx('app', drawer && 'drawer-open')}>
      <Rail />
      <Sidebar />
      <div className="drawer-scrim" onClick={() => ui({ drawer: false })} />
      <Suspense fallback={<main className="main" />}>
        <Content />
      </Suspense>
      {!connected && (
        <div className="offline-bar" role="status">
          <WifiOff /> Sem conexão com o servidor — tentando voltar…
        </div>
      )}
      <FocusPanel />
      <FocusWatcher />
      <Suspense fallback={null}>
        <ModalHost />
      </Suspense>
      <Palette />
      <ProfileCard />
      <MenuLayer />
      <Lightbox />
    </div>
  );
}

export function App() {
  useTheme();
  const phase = useApp((s) => s.phase);
  const route = useApp((s) => s.route);

  useEffect(() => {
    void boot();
  }, []);

  let screen;
  if (phase === 'boot') screen = <Splash />;
  else if (route.page === 'reset' || phase === 'auth') screen = <Auth />;
  else if (phase === 'error')
    screen = (
      <div className="splash">
        <Logo size={56} />
        <p>Não deu pra falar com o servidor.</p>
        <Button variant="primary" onClick={() => (useApp.setState({ phase: 'boot' }), void boot())}>
          Tentar de novo
        </Button>
      </div>
    );
  else if (route.page === 'invite') screen = <InviteScreen code={route.code} />;
  else screen = <Shell />;

  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}

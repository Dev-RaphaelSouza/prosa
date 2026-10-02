// A coluna da esquerda: início, conversas com novidade e os servidores.
import { memo } from 'react';
import { MessageCircle, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { serverMenu } from '../actions';
import { goDm, goHome, goServer, openMenu, openModal, serverUnread, useApp } from '../store';
import { useVoice } from '../voice';
import { Avatar, ServerIcon, cx } from './ui';
import type { Server } from '../../shared/types';

const count = (n: number) => (n > 99 ? '99+' : n);

const ServerButton = memo(function ServerButton({ server, active }: { server: Server; active: boolean }) {
  const unread = useApp(useShallow((s) => serverUnread(server, s.unread)));
  const inCall = useApp((s) => server.channels.some((c) => s.voice[c.id]));
  const mine = useVoice((s) => !!s.channelId && server.channels.some((c) => c.id === s.channelId));
  return (
    <button
      className={cx('rail-item', active && 'active', server.icon && 'has-img', !active && unread.count > 0 && 'unread')}
      data-tip={server.name}
      data-tip-pos="right"
      aria-label={server.name}
      onClick={() => goServer(server.id)}
      onContextMenu={(e) => openMenu(e, serverMenu(server))}
    >
      <ServerIcon server={server} />
      {unread.mentions > 0 ? <span className="badge rail-badge">{count(unread.mentions)}</span> : inCall && <span className={cx('rail-live', mine && 'mine')} />}
    </button>
  );
});

export function Rail() {
  const order = useApp((s) => s.serverOrder);
  const servers = useApp((s) => s.servers);
  const route = useApp((s) => s.route);
  const dms = useApp((s) => s.dms);
  const unread = useApp((s) => s.unread);
  const users = useApp((s) => s.users);
  const pending = useApp((s) => Object.values(s.friends).filter((f) => f.status === 'incoming').length);

  const home = route.page === 'home' || route.page === 'dm';
  const unreadDms = Object.values(dms)
    .filter((c) => unread[c.id]?.count)
    .sort((a, b) => (b.lastId ?? 0) - (a.lastId ?? 0));

  return (
    <nav className="rail" aria-label="Servidores">
      <button className={cx('rail-item home', home && 'active')} data-tip="Mensagens e amigos" data-tip-pos="right" aria-label="Mensagens e amigos" onClick={goHome}>
        <MessageCircle />
        {pending > 0 && <span className="badge rail-badge">{count(pending)}</span>}
      </button>

      {unreadDms.map((c) => {
        const user = users[c.recipientId ?? ''];
        if (!user) return null;
        return (
          <button key={c.id} className="rail-item has-img dm" data-tip={user.name} data-tip-pos="right" aria-label={`Conversa com ${user.name}`} onClick={() => goDm(c.id)}>
            <Avatar user={user} size="3rem" />
            <span className="badge rail-badge">{count(unread[c.id].count)}</span>
          </button>
        );
      })}

      <span className="rail-sep" />

      {order.map((id) => servers[id] && <ServerButton key={id} server={servers[id]} active={route.page === 'server' && route.serverId === id} />)}

      <button className="rail-item add" data-tip="Criar ou entrar num servidor" data-tip-pos="right" aria-label="Criar ou entrar num servidor" onClick={() => openModal({ type: 'createServer' })}>
        <Plus />
      </button>
    </nav>
  );
}

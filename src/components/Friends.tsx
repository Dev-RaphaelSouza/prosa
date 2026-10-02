// A tela inicial: amigos, pedidos pendentes e o campo de adicionar alguém.
import { useState, type FormEvent } from 'react';
import { Check, Menu, MessageCircle, MoreVertical, UserPlus, Users, X } from 'lucide-react';
import { api } from '../api';
import { acceptFriend, openDm, removeFriend } from '../actions';
import { STATUS_LABEL } from '../lib/format';
import { openMenu, openModal, openProfile, ui, useApp } from '../store';
import { Avatar, Button, IconButton, Segmented, useAction } from './ui';
import type { Friend, User } from '../../shared/types';

type Tab = 'online' | 'todos' | 'pendentes' | 'adicionar';

function FriendRow({ friend, user }: { friend: Friend; user: User }) {
  return (
    <div className="friend" onClick={(e) => openProfile(e, user.id)} role="button" tabIndex={0}>
      <Avatar user={user} size="2.4rem" status={friend.status === 'accepted' ? user.status : false} ring="var(--bg-2)" />
      <div className="grow dm-names">
        <span className="truncate">
          <b>{user.name}</b> <span className="muted">@{user.handle}</span>
        </span>
        <small className="truncate">
          {friend.status === 'incoming' ? 'Quer ser seu amigo' : friend.status === 'outgoing' ? 'Pedido enviado' : user.statusText || STATUS_LABEL[user.status]}
        </small>
      </div>
      <div className="row" onClick={(e) => e.stopPropagation()}>
        {friend.status === 'accepted' && (
          <>
            <IconButton label="Mensagem" onClick={() => openDm(user.id)}>
              <MessageCircle />
            </IconButton>
            <IconButton
              label="Mais"
              onClick={(e) =>
                openMenu(e, [
                  { label: 'Pôr num servidor', onSelect: () => openModal({ type: 'addToServer', userId: user.id }) },
                  { label: 'Desfazer amizade', danger: true, onSelect: () => removeFriend(user.id) },
                ])
              }
            >
              <MoreVertical />
            </IconButton>
          </>
        )}
        {friend.status === 'incoming' && (
          <IconButton label="Aceitar" on onClick={() => acceptFriend(user.id)}>
            <Check />
          </IconButton>
        )}
        {friend.status !== 'accepted' && (
          <IconButton label={friend.status === 'incoming' ? 'Recusar' : 'Cancelar pedido'} onClick={() => removeFriend(user.id)}>
            <X />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function AddFriend() {
  const [handle, setHandle] = useState('');
  const [sent, setSent] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSent('');
    const value = handle.trim().replace(/^@/, '');
    if (await run(() => api.post('/api/friends', { handle: value }))) {
      setSent(value);
      setHandle('');
    }
  };
  return (
    <form className="add-friend" onSubmit={submit}>
      <h3>Adicionar amigo</h3>
      <p className="muted">Digite o nome de usuário da pessoa — aquele com @, que aparece no perfil dela.</p>
      <div className="add-friend-field">
        <span>@</span>
        <input autoFocus value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="usuario" maxLength={21} autoCapitalize="none" spellCheck={false} />
        <Button variant="primary" small type="submit" loading={busy} disabled={handle.trim().length < 3}>
          Enviar pedido
        </Button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {sent && <p className="ok-text">Pedido enviado para @{sent}.</p>}
    </form>
  );
}

export function Friends() {
  const friends = useApp((s) => s.friends);
  const users = useApp((s) => s.users);
  const all = Object.values(friends)
    .map((friend) => ({ friend, user: users[friend.userId] }))
    .filter((x): x is { friend: Friend; user: User } => !!x.user)
    .sort((a, b) => a.user.name.localeCompare(b.user.name, 'pt-BR'));
  const accepted = all.filter((x) => x.friend.status === 'accepted');
  const pending = all.filter((x) => x.friend.status !== 'accepted');
  const incoming = pending.filter((x) => x.friend.status === 'incoming').length;
  const [tab, setTab] = useState<Tab>(accepted.length ? 'online' : pending.length ? 'pendentes' : 'adicionar');

  const list = tab === 'online' ? accepted.filter((x) => x.user.status !== 'offline') : tab === 'todos' ? accepted : pending;
  const empty: Record<Exclude<Tab, 'adicionar'>, string> = {
    online: accepted.length ? 'Nenhum amigo por aqui agora.' : 'Você ainda não adicionou ninguém.',
    todos: 'Você ainda não adicionou ninguém.',
    pendentes: 'Nenhum pedido esperando resposta.',
  };

  return (
    <main className="main">
      <header className="main-head">
        <IconButton label="Abrir servidores e canais" className="only-mobile" tip="bottom" onClick={() => ui({ drawer: true })}>
          <Menu />
        </IconButton>
        <div className="row head-title">
          <Users className="head-icon" />
          <b>Amigos</b>
        </div>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'online', label: 'Por aqui' },
            { id: 'todos', label: 'Todos' },
            {
              id: 'pendentes',
              label: (
                <>
                  Pendentes {incoming > 0 && <span className="badge">{incoming}</span>}
                </>
              ),
            },
            {
              id: 'adicionar',
              label: (
                <>
                  <UserPlus /> Adicionar
                </>
              ),
            },
          ]}
        />
      </header>
      <div className="friends">
        {tab === 'adicionar' ? (
          <AddFriend />
        ) : list.length === 0 ? (
          <div className="empty">
            <Users />
            <h3>{empty[tab]}</h3>
            {tab !== 'pendentes' && (
              <Button variant="primary" onClick={() => setTab('adicionar')}>
                <UserPlus /> Adicionar amigo
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="label friends-count">
              {tab === 'online' ? 'Por aqui' : tab === 'todos' ? 'Todos os amigos' : 'Pendentes'} — {list.length}
            </div>
            {list.map(({ friend, user }) => (
              <FriendRow key={user.id} friend={friend} user={user} />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

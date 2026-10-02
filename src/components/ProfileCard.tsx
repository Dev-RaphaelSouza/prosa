// O cartão de perfil que abre ao clicar em alguém: quem é, cargos, e o que dá pra fazer com a pessoa.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Ban, Check, Crown, MessageCircle, PhoneOff, Pencil, Plus, UserCheck, UserMinus, UserPlus, Volume2 } from 'lucide-react';
import { api } from '../api';
import { acceptFriend, openDm, removeFriend } from '../actions';
import { STATUS_LABEL, colorOf, formatDate } from '../lib/format';
import { useFetch } from '../lib/hooks';
import { useSettings } from '../settings';
import { openModal, toast, toastError, ui, useApp, useMe, useUi, useUser } from '../store';
import { setPeerVolume, useVoice } from '../voice';
import { Avatar, Button, cx } from './ui';
import { P, permsOf, rankOf } from '../../shared/perms';
import type { Profile, Server } from '../../shared/types';

function Roles({ server, userId }: { server: Server; userId: string }) {
  const me = useMe();
  const member = server.members.find((m) => m.userId === userId);
  const [editing, setEditing] = useState(false);
  if (!member) return null;
  const canEdit = (permsOf(server, me.id) & P.MANAGE_ROLES) !== 0;
  const rank = rankOf(server, me.id);
  const shown = server.roles.filter((r) => (editing ? r.position < rank || member.roles.includes(r.id) : member.roles.includes(r.id)));
  if (!shown.length && !canEdit) return null;

  const toggle = (roleId: string) => {
    const roles = member.roles.includes(roleId) ? member.roles.filter((r) => r !== roleId) : [...member.roles, roleId];
    api.put(`/api/servers/${server.id}/members/${userId}/roles`, { roles }).catch(toastError);
  };

  return (
    <section>
      <div className="label">Cargos</div>
      <div className="role-chips">
        {shown.map((role) => {
          const has = member.roles.includes(role.id);
          return editing && role.position < rank ? (
            <button key={role.id} className={cx('role-chip', !has && 'off')} onClick={() => toggle(role.id)}>
              <i style={{ background: role.color }} />
              {role.name}
              {has && <Check />}
            </button>
          ) : (
            <span key={role.id} className="role-chip">
              <i style={{ background: role.color }} />
              {role.name}
            </span>
          );
        })}
        {!shown.length && !editing && <span className="muted">Nenhum cargo.</span>}
        {canEdit && server.roles.some((r) => r.position < rank) && (
          <button className="role-chip add" onClick={() => setEditing(!editing)} aria-label={editing ? 'Concluir' : 'Editar cargos'}>
            {editing ? <Check /> : <Plus />}
          </button>
        )}
      </div>
    </section>
  );
}

function Card({ userId, x, y, flip, serverId }: { userId: string; x: number; y: number; flip: number; serverId?: string }) {
  const me = useMe();
  const user = useUser(userId);
  const server = useApp((s) => (serverId ? s.servers[serverId] : undefined));
  const friend = useApp((s) => s.friends[userId]);
  const inMyCall = useVoice((s) => !!s.channelId && userId in s.links);
  const volume = useSettings((s) => s.volumes[userId] ?? 1);
  const theirRoom = useApp((s) => server?.channels.find((c) => s.voice[c.id]?.[userId])?.id);
  const isMe = userId === me.id;
  const { data: profile } = useFetch<Profile>(isMe || !user.id ? null : `/api/users/${userId}/profile`);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => ui({ profile: null });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    // Abre à direita de onde clicou; sem espaço, vai pra esquerda (pra não cobrir a própria pessoa na lista).
    const left = x + width <= innerWidth - 8 ? x : flip - width;
    setPos({ left: Math.max(8, Math.min(left, innerWidth - width - 8)), top: Math.max(8, Math.min(y, innerHeight - height - 8)) });
  }, [x, y, flip, profile, server]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const perms = server ? permsOf(server, me.id) : 0;
  const outranks = !!server && !isMe && rankOf(server, me.id) > rankOf(server, userId);
  const isMember = !!server?.members.some((m) => m.userId === userId);
  const banner = user.banner ?? user.accent ?? colorOf(user.id || user.handle);

  const moderate = (ban: boolean) =>
    server &&
    openModal({
      type: 'confirm',
      title: `${ban ? 'Banir' : 'Expulsar'} ${user.name}?`,
      body: ban ? `Sai de ${server.name} agora e não volta nem por convite, até alguém desfazer o banimento.` : `Sai de ${server.name} agora. Com um convite novo dá pra voltar.`,
      action: ban ? 'Banir' : 'Expulsar',
      danger: true,
      onConfirm: () => (ban ? api.put(`/api/servers/${server.id}/bans/${userId}`) : api.del(`/api/servers/${server.id}/members/${userId}`)),
    });

  return (
    <div className="popover-layer" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className="profile" style={pos ?? { visibility: 'hidden' }} role="dialog" aria-label={`Perfil de ${user.name}`}>
        <div className="profile-banner" style={{ background: `linear-gradient(135deg, ${banner}, color-mix(in srgb, ${banner} 55%, #000))` }} />
        <div className="profile-avatar">
          <Avatar user={user} size="5rem" status={isMe ? me.status : user.status} ring="var(--bg-3)" />
        </div>
        <div className="profile-body">
          <h3>
            {user.name}
            {server?.ownerId === userId && <Crown className="crown" aria-label="Dono do servidor" />}
          </h3>
          <p className="muted">
            @{user.handle}
            {user.pronouns && ` · ${user.pronouns}`}
          </p>
          <p className="profile-status">{user.statusText || STATUS_LABEL[isMe ? me.status : user.status]}</p>

          {user.bio && (
            <section>
              <div className="label">Sobre</div>
              <p className="profile-bio">{user.bio}</p>
            </section>
          )}
          {server && isMember && <Roles server={server} userId={userId} />}
          {profile && (
            <section>
              <div className="label">Por aqui desde</div>
              <p>
                {formatDate(profile.createdAt)}
                {profile.mutualServers.length > 0 && ` · ${profile.mutualServers.length} ${profile.mutualServers.length === 1 ? 'servidor' : 'servidores'} em comum`}
              </p>
            </section>
          )}

          {inMyCall && (
            <section>
              <div className="label">Volume na chamada</div>
              <div className="row">
                <Volume2 className="muted" size={18} />
                <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setPeerVolume(userId, Number(e.target.value))} aria-label="Volume" />
                <span className="muted volume-value">{Math.round(volume * 100)}%</span>
              </div>
            </section>
          )}

          {isMe ? (
            <div className="profile-actions">
              <Button block onClick={() => openModal({ type: 'userSettings', tab: 'perfil' })}>
                <Pencil /> Editar perfil
              </Button>
            </div>
          ) : (
            user.id && (
              <div className="profile-actions">
                <Button variant="primary" block onClick={() => (close(), void openDm(userId))}>
                  <MessageCircle /> Mensagem
                </Button>
                {!friend && (
                  <Button
                    block
                    onClick={() =>
                      api
                        .post('/api/friends', { handle: user.handle })
                        .then(() => toast('Pedido de amizade enviado.', 'ok'))
                        .catch(toastError)
                    }
                  >
                    <UserPlus /> Adicionar amigo
                  </Button>
                )}
                {friend?.status === 'incoming' && (
                  <Button block onClick={() => acceptFriend(userId)}>
                    <UserCheck /> Aceitar amizade
                  </Button>
                )}
                {friend?.status === 'outgoing' && (
                  <Button block onClick={() => removeFriend(userId)}>
                    <UserMinus /> Cancelar pedido
                  </Button>
                )}
                {friend?.status === 'accepted' && (
                  <>
                    <Button block onClick={() => openModal({ type: 'addToServer', userId })}>
                      <Plus /> Pôr num servidor
                    </Button>
                    <Button variant="ghost" block onClick={() => removeFriend(userId)}>
                      <UserMinus /> Desfazer amizade
                    </Button>
                  </>
                )}
                {server && isMember && outranks && (perms & (P.KICK | P.BAN)) !== 0 && (
                  <>
                    <hr />
                    {theirRoom && (perms & P.KICK) !== 0 && (
                      <Button variant="ghost" block onClick={() => api.post(`/api/channels/${theirRoom}/voice/${userId}/disconnect`).catch(toastError)}>
                        <PhoneOff /> Tirar da chamada
                      </Button>
                    )}
                    {(perms & P.KICK) !== 0 && (
                      <Button variant="soft-danger" block onClick={() => moderate(false)}>
                        <UserMinus /> Expulsar
                      </Button>
                    )}
                    {(perms & P.BAN) !== 0 && (
                      <Button variant="soft-danger" block onClick={() => moderate(true)}>
                        <Ban /> Banir
                      </Button>
                    )}
                  </>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function ProfileCard() {
  const profile = useUi((s) => s.profile);
  return profile ? <Card key={profile.userId} {...profile} /> : null;
}

// A lista de membros do servidor: quem está por aí agrupado por cargo, depois quem está fora.
import { memo } from 'react';
import { Crown } from 'lucide-react';
import { openProfile, roleColor, useApp } from '../store';
import { Avatar } from './ui';
import type { Server, User } from '../../shared/types';

const MemberRow = memo(function MemberRow({ user, server, owner }: { user: User; server: Server; owner: boolean }) {
  return (
    <button className={'member' + (user.status === 'offline' ? ' offline' : '')} onClick={(e) => openProfile(e, user.id, server.id)}>
      <Avatar user={user} size="2rem" status={user.status} ring="var(--bg-1)" />
      <span className="grow dm-names">
        <span className="truncate" style={{ color: roleColor(server, user.id) }}>
          {user.name}
          {owner && <Crown className="crown" aria-label="Dono do servidor" />}
        </span>
        {user.statusText && <small className="truncate">{user.statusText}</small>}
      </span>
    </button>
  );
});

export function Members({ server }: { server: Server }) {
  const users = useApp((s) => s.users);

  const groups: { name: string; users: User[] }[] = server.roles.map((r) => ({ name: r.name, users: [] }));
  const online: User[] = [];
  const offline: User[] = [];
  for (const member of server.members) {
    const user = users[member.userId];
    if (!user) continue;
    if (user.status === 'offline') offline.push(user);
    else {
      // Quem tem cargo aparece sob o mais alto deles (server.roles já vem do topo pra base).
      const top = server.roles.findIndex((r) => member.roles.includes(r.id));
      (top >= 0 ? groups[top].users : online).push(user);
    }
  }
  groups.push({ name: 'Por aqui', users: online }, { name: 'Fora', users: offline });
  const byName = (a: User, b: User) => a.name.localeCompare(b.name, 'pt-BR');

  return (
    <aside className="members" aria-label="Membros">
      {groups
        .filter((g) => g.users.length)
        .map((group) => (
          <section key={group.name}>
            <div className="cat">
              <span className="cat-toggle">
                {group.name} — {group.users.length}
              </span>
            </div>
            {group.users.sort(byName).map((user) => (
              <MemberRow key={user.id} user={user} server={server} owner={server.ownerId === user.id} />
            ))}
          </section>
        ))}
    </aside>
  );
}

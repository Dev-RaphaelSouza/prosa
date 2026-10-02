// Ajustes do servidor: geral, canais, cargos, membros, convites, banidos, registro, manifesto e zona de perigo.
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Ban as BanIcon, Camera, Copy, FileJson, Hash, Link2, Plus, ScrollText, Settings, Shield, Trash2, TriangleAlert, Users, Volume2 } from 'lucide-react';
import { api } from '../../api';
import { copyText, inviteLink } from '../../actions';
import { formatStamp } from '../../lib/format';
import { useFetch } from '../../lib/hooks';
import { closeModal, openModal, openProfile, toast, toastError, useApp, useMe, type Modal as ModalState } from '../../store';
import { Avatar, Button, ColorPicker, IconButton, ImageUpload, ServerIcon, Setting, Toggle, cx, useAction } from '../ui';
import { Group, SettingsShell, type SettingsTab } from './Shell';
import { P, PERM_LIST, permsOf, rankOf } from '../../../shared/perms';
import { ACCENTS, BACKGROUNDS } from '../../../shared/theme';
import type { Ban, Channel, DriveMode, Invite, Manifest, ModLogEntry, Role, Server, User } from '../../../shared/types';

// ---------- geral ----------

function GeneralTab({ server }: { server: Server }) {
  const [name, setName] = useState(server.name);
  const { busy, error, run, setError } = useAction();
  const save = (patch: Record<string, unknown>) => run(() => api.patch(`/api/servers/${server.id}`, patch));
  return (
    <>
      <Group>
        <div className="group-pad row server-create">
          <ImageUpload onUploaded={(icon) => save({ icon })} onError={setError}>
            <span className="server-create-icon">{server.icon ? <img src={server.icon} alt="" /> : <Camera />}</span>
          </ImageUpload>
          <label className="field grow">
            <span>Nome do servidor</span>
            <div className="copy-field">
              <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <Button variant="primary" loading={busy} disabled={!name.trim() || name === server.name} onClick={() => save({ name })}>
                Salvar
              </Button>
            </div>
          </label>
        </div>
        {server.icon && (
          <Setting title="Ícone" desc="PNG, JPG, GIF ou WebP até 8 MB. Clique no ícone pra trocar.">
            <Button small variant="ghost" onClick={() => save({ icon: null })}>
              Remover ícone
            </Button>
          </Setting>
        )}
      </Group>
      {error && <p className="error-text">{error}</p>}

      <Group title="Tema do servidor">
        <div className="group-pad">
          <div className="field">
            <span>Cor de destaque</span>
            <ColorPicker value={server.theme.accent ?? null} onChange={(accent) => save({ theme: { ...server.theme, accent: accent ?? undefined } })} allowNone />
          </div>
          <div className="field">
            <span>Fundo</span>
            <div className="swatches">
              <button className={cx('swatch square', !server.theme.bg && 'on')} style={{ background: 'var(--bg-4)' }} onClick={() => save({ theme: { ...server.theme, bg: undefined } })} data-tip="O de cada pessoa" />
              {BACKGROUNDS.map((b) => (
                <button key={b.id} className={cx('swatch square', server.theme.bg === b.id && 'on')} style={{ background: b.swatch }} onClick={() => save({ theme: { ...server.theme, bg: b.id } })} data-tip={b.name} aria-label={b.name} />
              ))}
            </div>
          </div>
          <p className="hint">É a cara do servidor pra quem entra. Cada pessoa pode preferir as próprias cores nos ajustes dela.</p>
        </div>
      </Group>
    </>
  );
}

// ---------- canais ----------

const DRIVE_MODES: { id: DriveMode; name: string; desc: string }[] = [
  { id: 'livre', name: 'Mãos juntas', desc: 'Todo mundo na chamada mexe ao mesmo tempo.' },
  { id: 'volante', name: 'Volante', desc: 'Um por vez. Quem quer dirigir pede a vez e entra na fila.' },
  { id: 'poder', name: 'Só moderação', desc: 'Só quem tem a permissão de moderar o navegador dirige.' },
];

function ChannelEditor({ server, channel }: { server: Server; channel: Channel }) {
  const [form, setForm] = useState({ name: channel.name, topic: channel.topic, category: channel.category });
  const { busy, error, run } = useAction();
  useEffect(() => setForm({ name: channel.name, topic: channel.topic, category: channel.category }), [channel.id, channel.name, channel.topic, channel.category]);
  const dirty = form.name !== channel.name || form.topic !== channel.topic || form.category !== channel.category;
  const categories = [...new Set(server.channels.map((c) => c.category).filter(Boolean))];

  return (
    <div className="editor">
      <label className="field">
        <span>Nome do canal</span>
        <input className="input" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="field">
        <span>Descrição</span>
        <input className="input" value={form.topic} maxLength={120} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Opcional" />
      </label>
      <label className="field">
        <span>Categoria</span>
        <input className="input" list="categorias-edit" value={form.category} maxLength={40} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Sem categoria" />
        <datalist id="categorias-edit">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      {channel.kind === 'voice' && (
        <div className="field">
          <span>Quem dirige o navegador deste canal</span>
          <div className="choice-list">
            {DRIVE_MODES.map((m) => (
              <button key={m.id} className={cx('choice', channel.driveMode === m.id && 'on')} onClick={() => api.patch(`/api/channels/${channel.id}`, { driveMode: m.id }).catch(toastError)}>
                <b>{m.name}</b>
                <small>{m.desc}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <Button variant="primary" loading={busy} disabled={!dirty || !form.name.trim()} onClick={() => run(() => api.patch(`/api/channels/${channel.id}`, form))}>
          Salvar
        </Button>
        <span className="grow" />
        <Button
          variant="soft-danger"
          onClick={() =>
            openModal({
              type: 'confirm',
              title: `Apagar ${channel.kind === 'text' ? '#' : ''}${channel.name}?`,
              body: 'As mensagens do canal vão junto. Não dá pra desfazer.',
              action: 'Apagar canal',
              danger: true,
              onConfirm: () => api.del(`/api/channels/${channel.id}`),
              back: { type: 'serverSettings', serverId: server.id, tab: 'canais' },
            })
          }
        >
          <Trash2 /> Apagar canal
        </Button>
      </div>
    </div>
  );
}

function ChannelsTab({ server, selected, onSelect }: { server: Server; selected?: string; onSelect: (id: string) => void }) {
  const channel = server.channels.find((c) => c.id === selected) ?? server.channels[0];
  const move = (index: number, step: number) => {
    const ids = server.channels.map((c) => c.id);
    const target = index + step;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    api.put(`/api/servers/${server.id}/channels/order`, { ids }).catch(toastError);
  };
  return (
    <div className="split">
      <div className="split-list">
        {server.channels.map((c, i) => (
          <div key={c.id} className={cx('split-item', c.id === channel?.id && 'on')}>
            <button className="grow row" onClick={() => onSelect(c.id)}>
              {c.kind === 'voice' ? <Volume2 /> : <Hash />}
              <span className="grow truncate">{c.name}</span>
              {c.category && <small className="truncate">{c.category}</small>}
            </button>
            <IconButton label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </IconButton>
            <IconButton label="Descer" disabled={i === server.channels.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </IconButton>
          </div>
        ))}
        <Button block onClick={() => openModal({ type: 'createChannel', serverId: server.id })}>
          <Plus /> Criar canal
        </Button>
      </div>
      {channel ? <ChannelEditor server={server} channel={channel} /> : <p className="muted">Nenhum canal ainda.</p>}
    </div>
  );
}

// ---------- cargos ----------

function PermToggles({ value, mine, onChange, skipAdmin }: { value: number; mine: number; onChange: (perms: number) => void; skipAdmin?: boolean }) {
  return (
    <Group title="Permissões">
      {PERM_LIST.filter((p) => !(skipAdmin && p.key === 'ADMIN')).map((p) => {
        const bit = P[p.key];
        // Ninguém mexe numa permissão que não tem.
        const locked = !(mine & bit);
        return (
          <Setting key={p.key} title={p.name} desc={locked ? p.desc + ' (Você não tem essa permissão, então não pode mudá-la.)' : p.desc}>
            <span className={cx(locked && 'locked')}>
              <Toggle label={p.name} checked={(value & bit) !== 0} onChange={(on) => !locked && onChange(on ? value | bit : value & ~bit)} />
            </span>
          </Setting>
        );
      })}
    </Group>
  );
}

function RoleEditor({ server, role, mine, locked }: { server: Server; role: Role; mine: number; locked: boolean }) {
  const [name, setName] = useState(role.name);
  const { busy, error, run } = useAction();
  useEffect(() => setName(role.name), [role.id, role.name]);
  const patch = (body: Partial<Role>) => run(() => api.patch(`/api/roles/${role.id}`, body));
  const holders = server.members.filter((m) => m.roles.includes(role.id)).length;

  if (locked)
    return (
      <div className="editor">
        <p className="muted-2">
          <b style={{ color: role.color }}>{role.name}</b> está no mesmo nível ou acima do seu cargo mais alto — só quem está acima dele pode editá-lo.
        </p>
      </div>
    );

  return (
    <div className="editor">
      <label className="field">
        <span>Nome do cargo</span>
        <div className="copy-field">
          <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} style={{ color: role.color }} />
          <Button variant="primary" loading={busy} disabled={!name.trim() || name === role.name} onClick={() => patch({ name })}>
            Salvar
          </Button>
        </div>
        <small>
          {holders} {holders === 1 ? 'pessoa tem' : 'pessoas têm'} este cargo. Dê ou tire pelo perfil de cada um (aba Membros).
        </small>
      </label>
      <div className="field">
        <span>Cor</span>
        <ColorPicker value={role.color} onChange={(color) => color && patch({ color })} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <PermToggles value={role.perms} mine={mine} onChange={(perms) => patch({ perms })} />
      <div>
        <Button
          variant="soft-danger"
          onClick={() =>
            openModal({
              type: 'confirm',
              title: `Apagar o cargo ${role.name}?`,
              body: 'Quem tem o cargo perde as permissões que vinham dele.',
              action: 'Apagar cargo',
              danger: true,
              onConfirm: () => api.del(`/api/roles/${role.id}`),
              back: { type: 'serverSettings', serverId: server.id, tab: 'cargos' },
            })
          }
        >
          <Trash2 /> Apagar cargo
        </Button>
      </div>
    </div>
  );
}

function RolesTab({ server, selected, onSelect }: { server: Server; selected?: string; onSelect: (id: string) => void }) {
  const me = useMe();
  const mine = permsOf(server, me.id);
  const rank = rankOf(server, me.id);
  const role = server.roles.find((r) => r.id === selected);

  const move = (index: number, step: number) => {
    const ids = server.roles.map((r) => r.id);
    const target = index + step;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    api.put(`/api/servers/${server.id}/roles/order`, { ids }).catch(toastError);
  };
  const create = async () => {
    try {
      const color = ACCENTS[server.roles.length % ACCENTS.length].id;
      const { id } = await api.post<{ id: string }>(`/api/servers/${server.id}/roles`, { name: 'Novo cargo', color, perms: 0 });
      onSelect(id);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="split">
      <div className="split-list">
        {server.roles.map((r, i) => (
          <div key={r.id} className={cx('split-item', r.id === role?.id && 'on')}>
            <button className="grow row" onClick={() => onSelect(r.id)}>
              <i className="role-dot" style={{ background: r.color }} />
              <span className="grow truncate">{r.name}</span>
            </button>
            <IconButton label="Subir" disabled={i === 0 || r.position >= rank || server.roles[i - 1].position >= rank} onClick={() => move(i, -1)}>
              <ArrowUp />
            </IconButton>
            <IconButton label="Descer" disabled={i === server.roles.length - 1 || r.position >= rank} onClick={() => move(i, 1)}>
              <ArrowDown />
            </IconButton>
          </div>
        ))}
        <div className={cx('split-item', !role && 'on')}>
          <button className="grow row" onClick={() => onSelect('')}>
            <Users />
            <span className="grow">@todos</span>
          </button>
        </div>
        <Button block onClick={create}>
          <Plus /> Novo cargo
        </Button>
        <p className="hint">Quem está mais em cima manda em quem está embaixo. A cor do nome vem do cargo mais alto.</p>
      </div>
      {role ? (
        <RoleEditor server={server} role={role} mine={mine} locked={role.position >= rank} />
      ) : (
        <div className="editor">
          <p className="muted-2">O que todo mundo pode fazer, com ou sem cargo.</p>
          <PermToggles skipAdmin value={server.perms} mine={mine} onChange={(perms) => api.patch(`/api/servers/${server.id}`, { perms }).catch(toastError)} />
        </div>
      )}
    </div>
  );
}

// ---------- membros ----------

function MembersTab({ server }: { server: Server }) {
  const users = useApp((s) => s.users);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const rows = server.members
    .map((m) => ({ member: m, user: users[m.userId] }))
    .filter((r): r is { member: Server['members'][number]; user: User } => !!r.user && (r.user.name.toLowerCase().includes(query) || r.user.handle.includes(query)))
    .sort((a, b) => a.user.name.localeCompare(b.user.name, 'pt-BR'));
  return (
    <>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${server.members.length} membros`} />
      <div className="pick-list tall">
        {rows.map(({ member, user }) => (
          <button key={user.id} className="pick-row clickable" onClick={(e) => openProfile(e, user.id, server.id)}>
            <Avatar user={user} size="2.2rem" status={user.status} ring="var(--bg-2)" />
            <span className="dm-names grow">
              <span className="truncate">
                {user.name} {server.ownerId === user.id && <small className="muted">· dono</small>}
              </span>
              <small className="truncate">@{user.handle}</small>
            </span>
            <span className="role-chips">
              {server.roles
                .filter((r) => member.roles.includes(r.id))
                .map((r) => (
                  <span key={r.id} className="role-chip">
                    <i style={{ background: r.color }} />
                    {r.name}
                  </span>
                ))}
            </span>
          </button>
        ))}
        {rows.length === 0 && <p className="muted">Ninguém com esse nome.</p>}
      </div>
      <p className="hint">Clique em alguém pra abrir o perfil: é por lá que se dá cargo, expulsa e bane.</p>
    </>
  );
}

// ---------- convites, banidos, registro ----------

function InvitesTab({ server }: { server: Server }) {
  const users = useApp((s) => s.users);
  const { data, error, reload } = useFetch<Invite[]>(`/api/servers/${server.id}/invites`);
  const now = Date.now();
  return (
    <>
      {error && <p className="error-text">{error}</p>}
      {data?.length === 0 && <p className="muted">Nenhum convite criado ainda.</p>}
      <div className="pick-list tall">
        {data?.map((invite) => {
          const dead = (invite.expiresAt !== null && invite.expiresAt < now) || (invite.maxUses > 0 && invite.uses >= invite.maxUses);
          return (
            <div key={invite.code} className={cx('pick-row', dead && 'dead')}>
              <Link2 />
              <span className="dm-names grow">
                <span className="mono">{invite.code}</span>
                <small className="truncate">
                  de {users[invite.creatorId]?.name ?? 'alguém que saiu'} · {invite.uses}
                  {invite.maxUses ? `/${invite.maxUses}` : ''} {invite.uses === 1 && !invite.maxUses ? 'uso' : 'usos'} ·{' '}
                  {dead ? 'não vale mais' : invite.expiresAt ? `expira ${formatStamp(invite.expiresAt)}` : 'não expira'}
                </small>
              </span>
              {!dead && (
                <IconButton label="Copiar link" onClick={() => copyText(inviteLink(invite.code), 'Link de convite copiado.')}>
                  <Copy />
                </IconButton>
              )}
              <IconButton
                label="Revogar"
                onClick={() =>
                  api
                    .del(`/api/invites/${invite.code}`)
                    .then(reload)
                    .catch(toastError)
                }
              >
                <Trash2 />
              </IconButton>
            </div>
          );
        })}
      </div>
      <div>
        <Button onClick={() => openModal({ type: 'invite', serverId: server.id })}>
          <Plus /> Criar convite
        </Button>
      </div>
    </>
  );
}

function BansTab({ server }: { server: Server }) {
  const { data, error, reload } = useFetch<Ban[]>(`/api/servers/${server.id}/bans`);
  return (
    <>
      {error && <p className="error-text">{error}</p>}
      {data?.length === 0 && <p className="muted">Ninguém banido. Que continue assim.</p>}
      <div className="pick-list tall">
        {data?.map((ban) => (
          <div key={ban.user.id} className="pick-row">
            <Avatar user={ban.user} size="2.2rem" />
            <span className="dm-names grow">
              <span className="truncate">
                {ban.user.name} <small className="muted">@{ban.user.handle}</small>
              </span>
              <small className="truncate">
                {formatStamp(ban.createdAt)}
                {ban.reason && ` · ${ban.reason}`}
              </small>
            </span>
            <Button
              small
              onClick={() =>
                api
                  .del(`/api/servers/${server.id}/bans/${ban.user.id}`)
                  .then(reload)
                  .catch(toastError)
              }
            >
              Desbanir
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}

const ACTIONS: Record<string, string> = {
  'servidor.editar': 'mudou os ajustes do servidor',
  'servidor.transferir': 'passou o servidor para',
  'canal.criar': 'criou o canal',
  'canal.apagar': 'apagou o canal',
  'cargo.criar': 'criou o cargo',
  'cargo.editar': 'editou o cargo',
  'cargo.apagar': 'apagou o cargo',
  'membro.cargos': 'mudou os cargos de',
  'membro.expulsar': 'expulsou',
  'membro.banir': 'baniu',
  'membro.desbanir': 'desbaniu',
  'voz.desconectar': 'tirou da chamada',
};

function LogTab({ server }: { server: Server }) {
  const { data, error } = useFetch<{ entries: ModLogEntry[]; users: User[] }>(`/api/servers/${server.id}/modlog`);
  const names = new Map(data?.users.map((u) => [u.id, u.name]));
  return (
    <>
      {error && <p className="error-text">{error}</p>}
      {data?.entries.length === 0 && <p className="muted">Nada registrado ainda.</p>}
      <div className="log">
        {data?.entries.map((e) => (
          <div key={e.id} className="log-row">
            <time>{formatStamp(e.createdAt)}</time>
            <span>
              <b>{names.get(e.actorId) ?? 'Alguém'}</b> {ACTIONS[e.action] ?? e.action}{' '}
              {/* O alvo é uma pessoa quando o id bate com alguém; senão vale o detalhe (nome do canal ou do cargo). */}
              <b>{names.get(e.target) ?? (e.action.startsWith('membro') || e.action.startsWith('voz') ? '' : e.detail)}</b>
              {names.has(e.target) && e.detail && <span className="muted"> — {e.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function ManifestTab({ server }: { server: Server }) {
  const { data, error } = useFetch<Manifest>(`/api/servers/${server.id}/manifest`, `${server.id}:${server.channels.length}:${server.roles.length}`);
  const text = data ? JSON.stringify(data, null, 2) : '';
  return (
    <>
      <p className="muted-2">
        O manifesto é a estrutura deste servidor em JSON: canais, cargos e tema — sem mensagens nem membros. Guarde como cópia de segurança ou cole em <b>Criar servidor → Recriar de um manifesto</b> pra montar outro igual.
      </p>
      {error && <p className="error-text">{error}</p>}
      <textarea className="input mono" readOnly rows={16} value={text} onFocus={(e) => e.target.select()} />
      <div>
        <Button variant="primary" disabled={!text} onClick={() => copyText(text, 'Manifesto copiado.')}>
          <Copy /> Copiar manifesto
        </Button>
      </div>
    </>
  );
}

function DangerTab({ server }: { server: Server }) {
  const me = useMe();
  const users = useApp((s) => s.users);
  const [target, setTarget] = useState('');
  const others = server.members.filter((m) => m.userId !== me.id && users[m.userId]);
  return (
    <>
      <Group title="Passar o servidor adiante">
        <div className="group-pad">
          <p className="hint">A pessoa escolhida vira dona: pode tudo, inclusive apagar o servidor. Você continua como membro.</p>
          <div className="copy-field">
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Escolha um membro</option>
              {others.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {users[m.userId].name} (@{users[m.userId].handle})
                </option>
              ))}
            </select>
            <Button
              variant="soft-danger"
              disabled={!target}
              onClick={() =>
                openModal({
                  type: 'confirm',
                  title: `Passar ${server.name} para ${users[target].name}?`,
                  body: 'Só a nova pessoa dona pode devolver.',
                  action: 'Passar o servidor',
                  danger: true,
                  back: { type: 'serverSettings', serverId: server.id },
                  onConfirm: async () => {
                    await api.post(`/api/servers/${server.id}/transfer`, { userId: target });
                    toast('Servidor passado adiante.', 'ok');
                  },
                })
              }
            >
              Passar
            </Button>
          </div>
        </div>
      </Group>
      <Group title="Apagar">
        <Setting title="Apagar o servidor" desc="Some pra todo mundo, com canais e mensagens. Não dá pra desfazer.">
          <Button
            variant="danger"
            onClick={() =>
              openModal({
                type: 'confirm',
                title: `Apagar ${server.name}?`,
                body: 'Some pra todo mundo, com canais e mensagens. Não dá pra desfazer.',
                action: 'Apagar servidor',
                danger: true,
                back: { type: 'serverSettings', serverId: server.id, tab: 'perigo' },
                onConfirm: () => api.del(`/api/servers/${server.id}`),
              })
            }
          >
            <Trash2 /> Apagar servidor
          </Button>
        </Setting>
      </Group>
    </>
  );
}

export default function ServerSettings({ modal }: { modal: Extract<ModalState, { type: 'serverSettings' }> }) {
  const me = useMe();
  const server = useApp((s) => s.servers[modal.serverId]);
  // A aba pode trazer um item já escolhido: "canais:<id>" ou "cargos:<id>".
  const [tabId, selected] = (modal.tab ?? '').split(':');
  if (!server) return null;

  const perms = permsOf(server, me.id);
  const has = (bits: number) => (perms & bits) !== 0;
  const candidates: (SettingsTab | false)[] = [
    has(P.MANAGE_SERVER) && { id: 'geral', name: 'Geral', icon: <Settings /> },
    has(P.MANAGE_CHANNELS) && { id: 'canais', name: 'Canais', icon: <Hash /> },
    has(P.MANAGE_ROLES) && { id: 'cargos', name: 'Cargos', icon: <Shield /> },
    has(P.MANAGE_ROLES | P.KICK | P.BAN) && { id: 'membros', name: 'Membros', icon: <Users /> },
    has(P.MANAGE_SERVER) && { id: 'convites', name: 'Convites', icon: <Link2 /> },
    has(P.BAN) && { id: 'banidos', name: 'Banidos', icon: <BanIcon /> },
    has(P.MANAGE_SERVER | P.MANAGE_ROLES | P.KICK | P.BAN) && { id: 'registro', name: 'Registro de moderação', icon: <ScrollText /> },
    has(P.MANAGE_SERVER) && { id: 'manifesto', name: 'Manifesto', icon: <FileJson /> },
    server.ownerId === me.id && { id: 'perigo', name: 'Zona de perigo', icon: <TriangleAlert />, danger: true },
  ];
  const tabs = candidates.filter((t): t is SettingsTab => !!t);
  if (!tabs.length) return null;

  const tab = tabs.some((t) => t.id === tabId) ? tabId : tabs[0].id;
  const go = (id: string, item?: string) => openModal({ type: 'serverSettings', serverId: server.id, tab: item !== undefined ? `${id}:${item}` : id });

  return (
    <SettingsShell
      title={server.name}
      tabs={tabs}
      tab={tab}
      onTab={(id) => go(id)}
      onClose={closeModal}
      footer={
        <div className="settings-server">
          <span className="pick-icon">
            <ServerIcon server={server} />
          </span>
          <small className="truncate">
            {server.members.length} {server.members.length === 1 ? 'membro' : 'membros'}
          </small>
        </div>
      }
    >
      {tab === 'geral' && <GeneralTab server={server} />}
      {tab === 'canais' && <ChannelsTab server={server} selected={selected} onSelect={(id) => go('canais', id)} />}
      {tab === 'cargos' && <RolesTab server={server} selected={selected} onSelect={(id) => go('cargos', id)} />}
      {tab === 'membros' && <MembersTab server={server} />}
      {tab === 'convites' && <InvitesTab server={server} />}
      {tab === 'banidos' && <BansTab server={server} />}
      {tab === 'registro' && <LogTab server={server} />}
      {tab === 'manifesto' && <ManifestTab server={server} />}
      {tab === 'perigo' && <DangerTab server={server} />}
    </SettingsShell>
  );
}

import { all, get, run, tx } from '../db.ts';
import { DELETE, GET, PATCH, POST, PUT, fail, text, type UserRow } from '../http.ts';
import {
  addMember,
  channelFor,
  channelPayload,
  channelRow,
  defaultFocus,
  isMember,
  leaveVoice,
  log,
  memberIds,
  need,
  permsIn,
  publicUser,
  rankIn,
  removeMember,
  serverPayload,
  syncServer,
  userRow,
  usersOfServer,
  type ChannelRow,
  type ServerRow,
} from '../core.ts';
import { isOnline, rooms, sendTo, sendToMany } from '../live.ts';
import { setDriveMode } from '../browser.ts';
import { uploadUrl } from './auth.ts';
import { allow, newCode, newId, now, parseJson } from '../util.ts';
import { ALL_PERMS, DEFAULT_PERMS, P, type PermKey } from '../../shared/perms.ts';
import { isBackground, isHexColor } from '../../shared/theme.ts';
import type { Ban, Focus, Invite, InvitePreview, Manifest, ModLogEntry, ServerTheme } from '../../shared/types.ts';

type Seed = Manifest['canais'][number];

const TEMPLATES: Record<string, Seed[]> = {
  comunidade: [
    { nome: 'geral', tipo: 'texto', categoria: 'Texto', descricao: 'A conversa de todo dia' },
    { nome: 'avisos', tipo: 'texto', categoria: 'Texto', descricao: 'Novidades do servidor' },
    { nome: 'memes', tipo: 'texto', categoria: 'Texto' },
    { nome: 'Sala de voz', tipo: 'voz', categoria: 'Voz' },
    { nome: 'Jogos', tipo: 'voz', categoria: 'Voz' },
  ],
  sofa: [
    { nome: 'Sofá', tipo: 'voz', descricao: 'Voz, vídeo e o navegador da sala' },
    { nome: 'papo', tipo: 'texto' },
  ],
  trabalho: [
    { nome: 'geral', tipo: 'texto', categoria: 'Texto' },
    { nome: 'tarefas', tipo: 'texto', categoria: 'Texto', descricao: 'O que está na mesa' },
    { nome: 'links', tipo: 'texto', categoria: 'Texto' },
    { nome: 'Mesa compartilhada', tipo: 'voz', categoria: 'Voz' },
    { nome: 'Foco', tipo: 'voz', categoria: 'Voz', descricao: 'Sessão de foco, microfone aberto' },
  ],
  reuniao: [
    { nome: 'Sala principal', tipo: 'voz' },
    { nome: 'pauta', tipo: 'texto', descricao: 'Pauta e anotações' },
  ],
  foco: [
    { nome: 'Foco', tipo: 'voz', descricao: 'Sessão de foco sempre à mão' },
    { nome: 'metas', tipo: 'texto', descricao: 'O que cada um vai fazer hoje' },
  ],
  vazio: [],
};

function cleanChannelName(value: unknown, kind: string): string {
  let name = text(value, 'Nome do canal', 40, 1);
  if (kind === 'text') name = name.toLowerCase().replace(/\s+/g, '-').replace(/^#+/, '');
  if (!name) throw fail(400, 'Nome do canal não pode ficar em branco.');
  return name;
}

function cleanTheme(value: unknown): ServerTheme {
  const theme: ServerTheme = {};
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (isHexColor(v.accent)) theme.accent = v.accent;
    if (isBackground(v.bg)) theme.bg = v.bg;
  }
  return theme;
}

function cleanManifest(value: unknown): Manifest {
  const m = value as Partial<Manifest> | null;
  if (!m || typeof m !== 'object' || m.prosa !== 1) throw fail(400, 'Isso não parece um manifesto do Prosa (versão 1).');
  const canais = Array.isArray(m.canais) ? m.canais : [];
  const cargos = Array.isArray(m.cargos) ? m.cargos : [];
  if (canais.length > 30) throw fail(400, 'O manifesto tem mais de 30 canais.');
  if (cargos.length > 20) throw fail(400, 'O manifesto tem mais de 20 cargos.');
  return {
    prosa: 1,
    nome: text(m.nome, 'Nome do servidor', 60, 1),
    tema: cleanTheme(m.tema),
    canais: canais.map((c) => {
      if (c?.tipo !== 'texto' && c?.tipo !== 'voz') throw fail(400, 'O manifesto tem um canal de um tipo que não existe.');
      return {
        nome: cleanChannelName(c.nome, c.tipo === 'texto' ? 'text' : 'voice'),
        tipo: c.tipo,
        categoria: text(c.categoria ?? '', 'Categoria', 40),
        descricao: text(c.descricao ?? '', 'Descrição', 120),
      };
    }),
    cargos: cargos.map((r) => {
      if (!isHexColor(r?.cor)) throw fail(400, 'A cor de um cargo do manifesto não é uma cor (#rrggbb).');
      return {
        nome: text(r.nome, 'Nome do cargo', 32, 1),
        cor: r.cor,
        permissoes: (Array.isArray(r.permissoes) ? r.permissoes : []).filter((k) => k in P),
      };
    }),
  };
}

const permBits = (keys: string[]) => keys.reduce((bits, key) => bits | (P[key as PermKey] ?? 0), 0);

// ---------- servidor ----------

POST('/api/servers', (c) => {
  if (!allow('server:' + c.user.id, 10, 60 * 60_000)) throw fail(429, 'Muitos servidores criados em pouco tempo.');
  const manifest = c.body.manifest ? cleanManifest(c.body.manifest) : null;
  const name = manifest?.nome ?? text(c.body.name, 'Nome do servidor', 60, 1);
  const seeds = manifest?.canais ?? TEMPLATES[c.body.template] ?? TEMPLATES.comunidade;
  const theme = manifest?.tema ?? cleanTheme(c.body.theme);
  const id = newId();
  tx(() => {
    run(
      'INSERT INTO servers (id, name, icon, owner_id, theme, perms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      name,
      uploadUrl(c.body.icon ?? null, 'Ícone'),
      c.user.id,
      JSON.stringify(theme),
      DEFAULT_PERMS,
      now(),
    );
    run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', id, c.user.id, now());
    seeds.forEach((s, i) =>
      run(
        'INSERT INTO channels (id, server_id, kind, name, topic, category, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        id,
        s.tipo === 'texto' ? 'text' : 'voice',
        s.nome,
        s.descricao ?? '',
        s.categoria ?? '',
        i,
        now(),
      ),
    );
    const cargos = manifest?.cargos ?? [];
    cargos.forEach((r, i) =>
      run('INSERT INTO roles (id, server_id, name, color, perms, position) VALUES (?, ?, ?, ?, ?, ?)', newId(), id, r.nome, r.cor, permBits(r.permissoes), cargos.length - i),
    );
  });
  const server = serverPayload(id)!;
  sendTo(c.user.id, 'server.sync', { server, users: usersOfServer(id) });
  return { server };
});

PATCH('/api/servers/:id', (c) => {
  const perms = need(c.params.id, c.user.id);
  const s = get<ServerRow>('SELECT * FROM servers WHERE id = ?', c.params.id)!;
  const b = c.body;
  const touchesServer = b.name !== undefined || b.icon !== undefined || b.theme !== undefined;
  if (touchesServer && !(perms & P.MANAGE_SERVER)) throw fail(403, 'Você não tem permissão pra isso.');
  let everyone = s.perms;
  if (b.perms !== undefined) {
    if (!(perms & P.MANAGE_ROLES)) throw fail(403, 'Você não tem permissão pra isso.');
    everyone = Number(b.perms) & ALL_PERMS;
    // Ninguém distribui o que não tem, e @todos nunca vira administrador.
    if (everyone & P.ADMIN) throw fail(400, 'Não dá pra tornar todo mundo administrador.');
    if ((everyone ^ s.perms) & ~perms) throw fail(403, 'Você só pode mexer nas permissões que você mesmo tem.');
  }
  run(
    'UPDATE servers SET name = ?, icon = ?, theme = ?, perms = ? WHERE id = ?',
    b.name !== undefined ? text(b.name, 'Nome do servidor', 60, 1) : s.name,
    b.icon !== undefined ? uploadUrl(b.icon, 'Ícone') : s.icon,
    b.theme !== undefined ? JSON.stringify(cleanTheme(b.theme)) : s.theme,
    everyone,
    s.id,
  );
  log(s.id, c.user.id, 'servidor.editar');
  syncServer(s.id);
});

DELETE('/api/servers/:id', (c) => {
  need(c.params.id, c.user.id);
  const s = get<ServerRow>('SELECT * FROM servers WHERE id = ?', c.params.id)!;
  if (s.owner_id !== c.user.id) throw fail(403, 'Só quem é dono pode apagar o servidor.');
  const members = memberIds(s.id);
  for (const ch of all<ChannelRow>('SELECT * FROM channels WHERE server_id = ?', s.id)) for (const userId of [...(rooms.get(ch.id)?.keys() ?? [])]) leaveVoice(userId, 'encerrada');
  run('DELETE FROM servers WHERE id = ?', s.id);
  sendToMany(members, 'server.delete', { id: s.id });
});

POST('/api/servers/:id/leave', (c) => {
  need(c.params.id, c.user.id);
  const s = get<ServerRow>('SELECT * FROM servers WHERE id = ?', c.params.id)!;
  if (s.owner_id === c.user.id) throw fail(409, 'Quem é dono não sai: passe o servidor pra alguém ou apague.');
  removeMember(s.id, c.user.id);
});

POST('/api/servers/:id/transfer', (c) => {
  need(c.params.id, c.user.id);
  const s = get<ServerRow>('SELECT * FROM servers WHERE id = ?', c.params.id)!;
  if (s.owner_id !== c.user.id) throw fail(403, 'Só quem é dono pode passar o servidor adiante.');
  const target = String(c.body.userId ?? '');
  if (!isMember(s.id, target)) throw fail(404, 'Essa pessoa não está no servidor.');
  run('UPDATE servers SET owner_id = ? WHERE id = ?', target, s.id);
  log(s.id, c.user.id, 'servidor.transferir', target);
  syncServer(s.id);
});

GET('/api/servers/:id/manifest', (c): Manifest => {
  need(c.params.id, c.user.id, P.MANAGE_SERVER);
  const s = serverPayload(c.params.id)!;
  return {
    prosa: 1,
    nome: s.name,
    tema: s.theme,
    canais: s.channels.map((ch) => ({ nome: ch.name, tipo: ch.kind === 'text' ? 'texto' : 'voz', categoria: ch.category, descricao: ch.topic })),
    cargos: s.roles.map((r) => ({
      nome: r.name,
      cor: r.color,
      permissoes: (Object.keys(P) as PermKey[]).filter((k) => r.perms & P[k]),
    })),
  };
});

// ---------- canais ----------

POST('/api/servers/:id/channels', (c) => {
  need(c.params.id, c.user.id, P.MANAGE_CHANNELS);
  const kind = c.body.kind === 'voice' ? 'voice' : 'text';
  const count = get<{ n: number }>('SELECT COUNT(*) n FROM channels WHERE server_id = ?', c.params.id)!.n;
  if (count >= 60) throw fail(400, 'Este servidor já tem canais demais (60).');
  const id = newId();
  run(
    'INSERT INTO channels (id, server_id, kind, name, topic, category, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    c.params.id,
    kind,
    cleanChannelName(c.body.name, kind),
    text(c.body.topic ?? '', 'Descrição', 120),
    text(c.body.category ?? '', 'Categoria', 40),
    count,
    now(),
  );
  log(c.params.id, c.user.id, 'canal.criar', id, String(c.body.name));
  syncServer(c.params.id);
  return { channel: channelPayload(channelRow(id)!) };
});

PUT('/api/servers/:id/channels/order', (c) => {
  need(c.params.id, c.user.id, P.MANAGE_CHANNELS);
  const ids: unknown[] = Array.isArray(c.body.ids) ? c.body.ids : [];
  tx(() => ids.forEach((id, i) => run('UPDATE channels SET position = ? WHERE id = ? AND server_id = ?', i, String(id), c.params.id)));
  syncServer(c.params.id);
});

PATCH('/api/channels/:id', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  if (!ch.server_id) throw fail(400, 'Conversa privada não tem ajustes.');
  const perms = need(ch.server_id, c.user.id);
  const b = c.body;
  const touchesChannel = b.name !== undefined || b.topic !== undefined || b.category !== undefined;
  if (touchesChannel && !(perms & P.MANAGE_CHANNELS)) throw fail(403, 'Você não tem permissão pra isso.');
  let driveMode = ch.drive_mode;
  if (b.driveMode !== undefined) {
    if (!(perms & (P.BROWSER | P.MANAGE_CHANNELS))) throw fail(403, 'Você não tem permissão pra isso.');
    if (!['livre', 'volante', 'poder'].includes(b.driveMode)) throw fail(400, 'Esse modo de controle não existe.');
    driveMode = b.driveMode;
  }
  run(
    'UPDATE channels SET name = ?, topic = ?, category = ?, drive_mode = ? WHERE id = ?',
    b.name !== undefined ? cleanChannelName(b.name, ch.kind) : ch.name,
    b.topic !== undefined ? text(b.topic, 'Descrição', 120) : ch.topic,
    b.category !== undefined ? text(b.category, 'Categoria', 40) : ch.category,
    driveMode,
    ch.id,
  );
  if (driveMode !== ch.drive_mode) setDriveMode(ch.id, driveMode);
  syncServer(ch.server_id);
});

DELETE('/api/channels/:id', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  if (!ch.server_id) throw fail(400, 'Conversa privada não se apaga por aqui.');
  need(ch.server_id, c.user.id, P.MANAGE_CHANNELS);
  for (const userId of [...(rooms.get(ch.id)?.keys() ?? [])]) leaveVoice(userId, 'encerrada');
  run('DELETE FROM channels WHERE id = ?', ch.id);
  log(ch.server_id, c.user.id, 'canal.apagar', ch.id, ch.name);
  syncServer(ch.server_id);
});

POST('/api/channels/:id/voice/:userId/disconnect', (c) => {
  const ch = channelFor(c.user.id, c.params.id);
  if (!ch.server_id) throw fail(400, 'Só em canais de servidor.');
  need(ch.server_id, c.user.id, P.KICK);
  if (rankIn(ch.server_id, c.user.id) <= rankIn(ch.server_id, c.params.userId)) throw fail(403, 'Essa pessoa está acima ou no mesmo nível que você.');
  if (rooms.get(ch.id)?.has(c.params.userId)) {
    leaveVoice(c.params.userId, 'removido');
    log(ch.server_id, c.user.id, 'voz.desconectar', c.params.userId, ch.name);
  }
});

// ---------- cargos ----------

function roleFor(c: { params: Record<string, string>; user: UserRow }) {
  const role = get<{ id: string; server_id: string; name: string; color: string; perms: number; position: number }>('SELECT * FROM roles WHERE id = ?', c.params.id);
  if (!role) throw fail(404, 'Cargo não encontrado.');
  const perms = need(role.server_id, c.user.id, P.MANAGE_ROLES);
  if (rankIn(role.server_id, c.user.id) <= role.position) throw fail(403, 'Esse cargo está acima ou no mesmo nível que o seu.');
  return { role, perms };
}

function cleanRolePerms(value: unknown, actorPerms: number, current: number): number {
  const perms = Number(value) & ALL_PERMS;
  if ((perms ^ current) & ~actorPerms) throw fail(403, 'Você só pode dar as permissões que você mesmo tem.');
  return perms;
}

POST('/api/servers/:id/roles', (c) => {
  const perms = need(c.params.id, c.user.id, P.MANAGE_ROLES);
  const count = get<{ n: number }>('SELECT COUNT(*) n FROM roles WHERE server_id = ?', c.params.id)!.n;
  if (count >= 30) throw fail(400, 'Este servidor já tem cargos demais (30).');
  if (!isHexColor(c.body.color)) throw fail(400, 'A cor do cargo não é uma cor (#rrggbb).');
  const id = newId();
  // Cargo novo nasce no fim da fila; os outros sobem um degrau.
  tx(() => {
    run('UPDATE roles SET position = position + 1 WHERE server_id = ?', c.params.id);
    run(
      'INSERT INTO roles (id, server_id, name, color, perms, position) VALUES (?, ?, ?, ?, ?, 1)',
      id,
      c.params.id,
      text(c.body.name, 'Nome do cargo', 32, 1),
      c.body.color,
      cleanRolePerms(c.body.perms ?? 0, perms, 0),
    );
  });
  log(c.params.id, c.user.id, 'cargo.criar', id, String(c.body.name));
  syncServer(c.params.id);
  return { id };
});

PATCH('/api/roles/:id', (c) => {
  const { role, perms } = roleFor(c);
  const b = c.body;
  if (b.color !== undefined && !isHexColor(b.color)) throw fail(400, 'A cor do cargo não é uma cor (#rrggbb).');
  run(
    'UPDATE roles SET name = ?, color = ?, perms = ? WHERE id = ?',
    b.name !== undefined ? text(b.name, 'Nome do cargo', 32, 1) : role.name,
    b.color ?? role.color,
    b.perms !== undefined ? cleanRolePerms(b.perms, perms, role.perms) : role.perms,
    role.id,
  );
  log(role.server_id, c.user.id, 'cargo.editar', role.id, role.name);
  syncServer(role.server_id);
});

DELETE('/api/roles/:id', (c) => {
  const { role } = roleFor(c);
  run('DELETE FROM roles WHERE id = ?', role.id);
  log(role.server_id, c.user.id, 'cargo.apagar', role.id, role.name);
  syncServer(role.server_id);
});

PUT('/api/servers/:id/roles/order', (c) => {
  need(c.params.id, c.user.id, P.MANAGE_ROLES);
  const rank = rankIn(c.params.id, c.user.id);
  const roles = all<{ id: string; position: number }>('SELECT id, position FROM roles WHERE server_id = ?', c.params.id);
  const ids: string[] = (Array.isArray(c.body.ids) ? c.body.ids : []).map(String);
  if (ids.length !== roles.length || roles.some((r) => !ids.includes(r.id))) throw fail(400, 'A lista de cargos não confere.');
  // Vem do topo pra base. Só se move o que está abaixo de você, e nada pode passar do seu nível.
  const moves = roles.map((r) => ({ id: r.id, from: r.position, to: ids.length - ids.indexOf(r.id) })).filter((m) => m.from !== m.to);
  if (moves.some((m) => m.from >= rank || m.to >= rank)) throw fail(403, 'Você só reordena os cargos abaixo do seu.');
  tx(() => moves.forEach((m) => run('UPDATE roles SET position = ? WHERE id = ?', m.to, m.id)));
  syncServer(c.params.id);
});

PUT('/api/servers/:id/members/:userId/roles', (c) => {
  need(c.params.id, c.user.id, P.MANAGE_ROLES);
  if (!isMember(c.params.id, c.params.userId)) throw fail(404, 'Essa pessoa não está no servidor.');
  const rank = rankIn(c.params.id, c.user.id);
  const roles = all<{ id: string; position: number }>('SELECT id, position FROM roles WHERE server_id = ?', c.params.id);
  const wanted = new Set<string>((Array.isArray(c.body.roles) ? c.body.roles : []).map(String));
  const current = new Set(
    all<{ role_id: string }>('SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?', c.params.id, c.params.userId).map((r) => r.role_id),
  );
  tx(() => {
    for (const role of roles) {
      if (wanted.has(role.id) === current.has(role.id)) continue;
      if (role.position >= rank) throw fail(403, 'Você só distribui os cargos abaixo do seu.');
      if (wanted.has(role.id)) run('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', c.params.id, c.params.userId, role.id);
      else run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?', c.params.id, c.params.userId, role.id);
    }
  });
  log(c.params.id, c.user.id, 'membro.cargos', c.params.userId);
  syncServer(c.params.id);
});

// ---------- moderação ----------

function moderate(c: { params: Record<string, string>; user: UserRow }, bit: number) {
  need(c.params.id, c.user.id, bit);
  const target = c.params.userId;
  if (target === c.user.id) throw fail(400, 'Não dá pra fazer isso com você mesmo.');
  if (rankIn(c.params.id, c.user.id) <= rankIn(c.params.id, target)) throw fail(403, 'Essa pessoa está acima ou no mesmo nível que você.');
  return target;
}

DELETE('/api/servers/:id/members/:userId', (c) => {
  const target = moderate(c, P.KICK);
  if (!isMember(c.params.id, target)) throw fail(404, 'Essa pessoa não está no servidor.');
  removeMember(c.params.id, target);
  log(c.params.id, c.user.id, 'membro.expulsar', target);
});

PUT('/api/servers/:id/bans/:userId', (c) => {
  const target = moderate(c, P.BAN);
  if (!userRow(target)) throw fail(404, 'Pessoa não encontrada.');
  const reason = text(c.body.reason ?? '', 'Motivo', 200);
  run('INSERT OR REPLACE INTO bans (server_id, user_id, by_id, reason, created_at) VALUES (?, ?, ?, ?, ?)', c.params.id, target, c.user.id, reason, now());
  if (isMember(c.params.id, target)) removeMember(c.params.id, target);
  log(c.params.id, c.user.id, 'membro.banir', target, reason);
});

DELETE('/api/servers/:id/bans/:userId', (c) => {
  need(c.params.id, c.user.id, P.BAN);
  run('DELETE FROM bans WHERE server_id = ? AND user_id = ?', c.params.id, c.params.userId);
  log(c.params.id, c.user.id, 'membro.desbanir', c.params.userId);
});

GET('/api/servers/:id/bans', (c): Ban[] => {
  need(c.params.id, c.user.id, P.BAN);
  return all<UserRow & { reason: string; by_id: string; banned_at: number }>(
    'SELECT u.*, b.reason, b.by_id, b.created_at banned_at FROM bans b JOIN users u ON u.id = b.user_id WHERE b.server_id = ? ORDER BY b.created_at DESC',
    c.params.id,
  ).map((r) => ({ user: publicUser(r), reason: r.reason, byId: r.by_id, createdAt: r.banned_at }));
});

GET('/api/servers/:id/modlog', (c) => {
  const perms = need(c.params.id, c.user.id);
  if (!(perms & (P.MANAGE_SERVER | P.KICK | P.BAN | P.MANAGE_ROLES))) throw fail(403, 'Você não tem permissão pra isso.');
  const entries: ModLogEntry[] = all<{ id: number; actor_id: string; action: string; target: string; detail: string; created_at: number }>(
    'SELECT * FROM modlog WHERE server_id = ? ORDER BY id DESC LIMIT 200',
    c.params.id,
  ).map((r) => ({ id: r.id, actorId: r.actor_id, action: r.action, target: r.target, detail: r.detail, createdAt: r.created_at }));
  // Quem saiu ou foi banido não está mais na lista de membros do cliente: os nomes vão junto.
  const ids = new Set(entries.flatMap((e) => [e.actorId, e.target]));
  const users = [...ids].map((id) => userRow(id)).filter((u): u is UserRow => !!u).map(publicUser);
  return { entries, users };
});

// ---------- convites ----------

interface InviteRow {
  code: string;
  server_id: string;
  creator_id: string;
  uses: number;
  max_uses: number;
  expires_at: number | null;
  created_at: number;
}

const invitePayload = (r: InviteRow): Invite => ({
  code: r.code,
  serverId: r.server_id,
  creatorId: r.creator_id,
  uses: r.uses,
  maxUses: r.max_uses,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

const inviteValid = (r: InviteRow) => (!r.expires_at || r.expires_at > now()) && (!r.max_uses || r.uses < r.max_uses);

POST('/api/servers/:id/invites', (c) => {
  need(c.params.id, c.user.id, P.INVITE);
  const expiresIn = Math.max(0, Math.min(Number(c.body.expiresIn) || 0, 30 * 86400));
  const maxUses = Math.max(0, Math.min(Math.floor(Number(c.body.maxUses) || 0), 1000));
  // Pedir de novo o convite padrão (sem limite) devolve o mesmo link em vez de empilhar códigos.
  if (!expiresIn && !maxUses) {
    const same = get<InviteRow>('SELECT * FROM invites WHERE server_id = ? AND creator_id = ? AND max_uses = 0 AND expires_at IS NULL', c.params.id, c.user.id);
    if (same) return invitePayload(same);
  }
  const code = newCode();
  run(
    'INSERT INTO invites (code, server_id, creator_id, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    code,
    c.params.id,
    c.user.id,
    maxUses,
    expiresIn ? now() + expiresIn * 1000 : null,
    now(),
  );
  return invitePayload(get<InviteRow>('SELECT * FROM invites WHERE code = ?', code)!);
});

GET('/api/servers/:id/invites', (c) => {
  need(c.params.id, c.user.id, P.MANAGE_SERVER);
  return all<InviteRow>('SELECT * FROM invites WHERE server_id = ? ORDER BY created_at DESC', c.params.id).map(invitePayload);
});

DELETE('/api/invites/:code', (c) => {
  const invite = get<InviteRow>('SELECT * FROM invites WHERE code = ?', c.params.code);
  if (!invite) throw fail(404, 'Convite não encontrado.');
  const perms = need(invite.server_id, c.user.id);
  if (invite.creator_id !== c.user.id && !(perms & P.MANAGE_SERVER)) throw fail(403, 'Você não tem permissão pra isso.');
  run('DELETE FROM invites WHERE code = ?', invite.code);
});

GET(
  '/api/invites/:code',
  (c): InvitePreview => {
    const invite = get<InviteRow>('SELECT * FROM invites WHERE code = ?', c.params.code.toLowerCase());
    if (!invite) throw fail(404, 'Esse convite não existe.');
    if (!inviteValid(invite)) throw fail(410, 'Esse convite não vale mais.');
    const s = get<ServerRow>('SELECT * FROM servers WHERE id = ?', invite.server_id)!;
    const members = memberIds(s.id);
    const inviter = userRow(invite.creator_id);
    return {
      code: invite.code,
      server: { id: s.id, name: s.name, icon: s.icon, members: members.length, online: members.filter(isOnline).length },
      inviter: inviter ? publicUser(inviter) : null,
      member: !!c.user && members.includes(c.user.id),
    };
  },
  { public: true },
);

POST('/api/invites/:code/accept', (c) => {
  const invite = get<InviteRow>('SELECT * FROM invites WHERE code = ?', c.params.code.toLowerCase());
  if (!invite) throw fail(404, 'Esse convite não existe.');
  if (isMember(invite.server_id, c.user.id)) return { serverId: invite.server_id };
  if (!inviteValid(invite)) throw fail(410, 'Esse convite não vale mais.');
  if (get('SELECT 1 x FROM bans WHERE server_id = ? AND user_id = ?', invite.server_id, c.user.id)) throw fail(403, 'Você foi banido deste servidor.');
  run('UPDATE invites SET uses = uses + 1 WHERE code = ?', invite.code);
  addMember(invite.server_id, c.user.id);
  return { serverId: invite.server_id };
});

// ---------- sessão de foco ----------

POST('/api/servers/:id/focus', (c) => {
  need(c.params.id, c.user.id);
  const s = get<ServerRow>('SELECT * FROM servers WHERE id = ?', c.params.id)!;
  const focus: Focus = { ...defaultFocus(), ...parseJson<Partial<Focus>>(s.focus, {}) };
  const b = c.body;
  switch (b.action) {
    case 'start':
      focus.phase = 'foco';
      focus.endsAt = now() + focus.focusMin * 60_000;
      focus.round += 1;
      break;
    case 'break':
      focus.phase = 'pausa';
      focus.endsAt = now() + focus.breakMin * 60_000;
      break;
    case 'stop':
      focus.phase = 'idle';
      focus.endsAt = null;
      focus.round = 0;
      break;
    case 'config':
      focus.focusMin = Math.max(1, Math.min(Math.floor(Number(b.focusMin)) || 25, 180));
      focus.breakMin = Math.max(1, Math.min(Math.floor(Number(b.breakMin)) || 5, 60));
      break;
    case 'task.add':
      if (focus.tasks.length >= 50) throw fail(400, 'A lista já tem tarefas demais.');
      focus.tasks.push({ id: newId(), text: text(b.text, 'Tarefa', 120, 1), done: false, by: c.user.id });
      break;
    case 'task.toggle':
      focus.tasks = focus.tasks.map((t) => (t.id === b.id ? { ...t, done: !t.done } : t));
      break;
    case 'task.remove':
      focus.tasks = focus.tasks.filter((t) => t.id !== b.id);
      break;
    case 'task.clear':
      focus.tasks = focus.tasks.filter((t) => !t.done);
      break;
    default:
      throw fail(400, 'Ação desconhecida.');
  }
  run('UPDATE servers SET focus = ? WHERE id = ?', JSON.stringify(focus), s.id);
  sendToMany(memberIds(s.id), 'focus.update', { serverId: s.id, focus, by: c.user.id });
  return focus;
});

// Usado pelo perfil: pôr um amigo direto num servidor seu, sem link.
POST('/api/servers/:id/add-friend', (c) => {
  need(c.params.id, c.user.id, P.INVITE);
  const target = String(c.body.userId ?? '');
  const friends = get("SELECT 1 x FROM friends WHERE status = 'accepted' AND ((a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1))", c.user.id, target);
  if (!friends) throw fail(403, 'Só dá pra adicionar direto quem é seu amigo.');
  if (get('SELECT 1 x FROM bans WHERE server_id = ? AND user_id = ?', c.params.id, target)) throw fail(403, 'Essa pessoa foi banida deste servidor.');
  if (permsIn(c.params.id, target) === null) addMember(c.params.id, target);
});

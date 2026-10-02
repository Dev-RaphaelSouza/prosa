import { all, get, run } from '../db.ts';
import { GET, PATCH, POST, fail, text, type UserRow } from '../http.ts';
import { audienceOf, bootstrap, broadcastUser, leaveVoice, mePayload, presenceOf, publicUser, syncServer, userRow } from '../core.ts';
import { byUser, sendToMany } from '../live.ts';
import { browserStates } from '../browser.ts';
import { allow, hashPassword, newId, newToken, now, verifyPassword } from '../util.ts';
import type { Profile } from '../../shared/types.ts';

const HANDLE = /^[a-z0-9_.]{3,20}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

function session(userId: string): string {
  const token = newToken();
  run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, now());
  return token;
}

function cleanHandle(value: unknown): string {
  const handle = text(value, 'Usuário', 20, 3).toLowerCase().replace(/^@/, '');
  if (!HANDLE.test(handle)) throw fail(400, 'O usuário só pode ter letras minúsculas, números, ponto e sublinhado.');
  return handle;
}

function cleanPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 6) throw fail(400, 'A senha precisa de pelo menos 6 caracteres.');
  if (value.length > 200) throw fail(400, 'Senha grande demais.');
  return value;
}

function cleanEmail(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const email = text(value, 'E-mail', 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Esse e-mail não parece válido.');
  return email;
}

/** Um upload nosso: só aceitamos caminho gerado pelo próprio servidor. */
export function uploadUrl(value: unknown, label: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\/uploads\/[a-z0-9]+\.[a-z0-9]+$/.test(value)) throw fail(400, `${label}: imagem inválida.`);
  return value;
}

POST(
  '/api/auth/register',
  async (c) => {
    // Folgado o bastante pra uma turma inteira atrás do mesmo roteador criar conta de uma vez.
    if (!allow('register:' + c.ip, 30, 10 * 60_000)) throw fail(429, 'Muitas contas criadas daqui. Tente de novo mais tarde.');
    const handle = cleanHandle(c.body.handle);
    const password = cleanPassword(c.body.password);
    const name = text(c.body.name || handle, 'Nome', 32, 1);
    const email = cleanEmail(c.body.email);
    if (get('SELECT 1 x FROM users WHERE handle = ?', handle)) throw fail(409, 'Esse usuário já existe. Escolha outro.');
    const id = newId();
    run('INSERT INTO users (id, handle, name, email, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, handle, name, email, await hashPassword(password), now());
    return { token: session(id) };
  },
  { public: true },
);

POST(
  '/api/auth/login',
  async (c) => {
    if (!allow('login:' + c.ip, 12, 60_000)) throw fail(429, 'Muitas tentativas. Espere um minuto.');
    const login = text(c.body.handle, 'Usuário', 120, 1).toLowerCase().replace(/^@/, '');
    const user = get<UserRow>('SELECT * FROM users WHERE handle = ?1 OR email = ?1', login);
    if (!user || !(await verifyPassword(String(c.body.password ?? ''), user.pass))) throw fail(401, 'Usuário ou senha incorretos.');
    return { token: session(user.id) };
  },
  { public: true },
);

POST('/api/auth/logout', (c) => {
  run('DELETE FROM sessions WHERE token = ?', c.token);
});

// Sem serviço de e-mail configurado, o link de redefinição sai no console do servidor:
// quem hospeda repassa pra pessoa. A resposta é a mesma existindo a conta ou não.
POST(
  '/api/auth/forgot',
  (c) => {
    if (!allow('forgot:' + c.ip, 5, 10 * 60_000)) throw fail(429, 'Muitas tentativas. Tente de novo mais tarde.');
    const login = text(c.body.handle, 'Usuário', 120, 1).toLowerCase().replace(/^@/, '');
    const user = get<UserRow>('SELECT * FROM users WHERE handle = ?1 OR email = ?1', login);
    if (user) {
      const token = newToken();
      run('INSERT INTO resets (token, user_id, expires_at) VALUES (?, ?, ?)', token, user.id, now() + 60 * 60_000);
      const origin = c.req.headers.origin ?? `http://${c.req.headers.host}`;
      console.log(`[senha] link de redefinição para @${user.handle} (vale 1 hora): ${origin}/redefinir/${token}`);
    }
  },
  { public: true },
);

POST(
  '/api/auth/reset',
  async (c) => {
    const password = cleanPassword(c.body.password);
    const reset = get<{ user_id: string; expires_at: number }>('SELECT user_id, expires_at FROM resets WHERE token = ?', String(c.body.token ?? ''));
    if (!reset || reset.expires_at < now()) throw fail(400, 'Esse link de redefinição não vale mais. Peça outro.');
    run('UPDATE users SET pass = ? WHERE id = ?', await hashPassword(password), reset.user_id);
    run('DELETE FROM resets WHERE user_id = ?', reset.user_id);
    run('DELETE FROM sessions WHERE user_id = ?', reset.user_id);
    return { token: session(reset.user_id) };
  },
  { public: true },
);

GET('/api/bootstrap', (c) => {
  const data = bootstrap(c.user);
  const visible = new Set(data.dms.map((d) => d.id));
  for (const s of data.servers) for (const ch of s.channels) visible.add(ch.id);
  return { ...data, browsers: browserStates().filter((b) => visible.has(b.channelId)) };
});

PATCH('/api/me', (c) => {
  const b = c.body;
  const u = c.user;
  const next = {
    name: b.name !== undefined ? text(b.name, 'Nome', 32, 1) : u.name,
    handle: b.handle !== undefined ? cleanHandle(b.handle) : u.handle,
    email: b.email !== undefined ? cleanEmail(b.email) : u.email,
    bio: b.bio !== undefined ? text(b.bio, 'Bio', 190) : u.bio,
    pronouns: b.pronouns !== undefined ? text(b.pronouns, 'Pronomes', 24) : u.pronouns,
    avatar: b.avatar !== undefined ? uploadUrl(b.avatar, 'Avatar') : u.avatar,
    banner: u.banner,
    accent: u.accent,
    status: u.status,
    status_text: b.statusText !== undefined ? text(b.statusText, 'Status', 80) : u.status_text,
  };
  if (b.banner !== undefined) {
    if (b.banner !== null && !COLOR.test(String(b.banner))) throw fail(400, 'Cor de capa inválida.');
    next.banner = b.banner;
  }
  if (b.accent !== undefined) {
    if (b.accent !== null && !COLOR.test(String(b.accent))) throw fail(400, 'Cor de destaque inválida.');
    next.accent = b.accent;
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw fail(400, 'Status inválido.');
    next.status = b.status;
  }
  if (next.handle !== u.handle && get('SELECT 1 x FROM users WHERE handle = ? AND id != ?', next.handle, u.id))
    throw fail(409, 'Esse usuário já existe. Escolha outro.');

  run(
    'UPDATE users SET name = ?, handle = ?, email = ?, bio = ?, pronouns = ?, avatar = ?, banner = ?, accent = ?, status = ?, status_text = ? WHERE id = ?',
    next.name,
    next.handle,
    next.email,
    next.bio,
    next.pronouns,
    next.avatar,
    next.banner,
    next.accent,
    next.status,
    next.status_text,
    u.id,
  );
  broadcastUser(u.id);
  if (next.status !== u.status) sendToMany(audienceOf(u.id), 'presence', presenceOf(u.id));
  return mePayload(userRow(u.id)!);
});

POST('/api/me/password', async (c) => {
  if (!(await verifyPassword(String(c.body.current ?? ''), c.user.pass))) throw fail(403, 'A senha atual não confere.');
  run('UPDATE users SET pass = ? WHERE id = ?', await hashPassword(cleanPassword(c.body.next)), c.user.id);
  // As outras sessões caem; esta continua.
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', c.user.id, c.token);
});

GET('/api/users/:id/profile', (c): Profile => {
  const target = userRow(c.params.id);
  // Só dá pra ver o perfil de quem você já enxerga (servidor, amizade ou DM em comum).
  if (!target || !audienceOf(c.user.id).includes(target.id)) throw fail(404, 'Pessoa não encontrada.');
  const mutual = all<{ server_id: string }>(
    'SELECT m1.server_id FROM members m1 JOIN members m2 ON m2.server_id = m1.server_id WHERE m1.user_id = ? AND m2.user_id = ?',
    c.user.id,
    target.id,
  );
  return { user: publicUser(target), mutualServers: mutual.map((m) => m.server_id), createdAt: target.created_at };
});

// Apaga a conta. As mensagens ficam (sem autor conhecido); quem é dono de servidor resolve isso antes.
POST('/api/me/delete', async (c) => {
  if (!(await verifyPassword(String(c.body.password ?? ''), c.user.pass))) throw fail(403, 'A senha não confere.');
  if (get('SELECT 1 x FROM servers WHERE owner_id = ?', c.user.id)) throw fail(409, 'Antes de apagar a conta, apague os servidores que são seus.');
  const servers = all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ?', c.user.id);
  leaveVoice(c.user.id);
  run('DELETE FROM member_roles WHERE user_id = ?', c.user.id);
  run('DELETE FROM users WHERE id = ?', c.user.id);
  for (const conn of byUser.get(c.user.id) ?? []) conn.ws.close(4001, 'conta apagada');
  for (const s of servers) syncServer(s.server_id);
});

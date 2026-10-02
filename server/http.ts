import type { IncomingMessage, ServerResponse } from 'node:http';
import { get } from './db.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const fail = (status: number, message: string) => new HttpError(status, message);

export interface UserRow {
  id: string;
  handle: string;
  name: string;
  email: string | null;
  pass: string;
  avatar: string | null;
  banner: string | null;
  accent: string | null;
  bio: string;
  pronouns: string;
  status: string;
  status_text: string;
  created_at: number;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  /** Sempre preenchido em rota autenticada; em rota pública só se a pessoa estiver logada. */
  user: UserRow;
  token: string | null;
  ip: string;
}

type Handler = (c: Ctx) => unknown;
interface Options {
  public?: boolean;
  /** O handler lê o corpo por conta própria (upload). */
  raw?: boolean;
}
interface Route extends Options {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler, opts: Options = {}) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, key) => (keys.push(key), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, ...opts });
}
export const GET = (path: string, h: Handler, o?: Options) => route('GET', path, h, o);
export const POST = (path: string, h: Handler, o?: Options) => route('POST', path, h, o);
export const PUT = (path: string, h: Handler, o?: Options) => route('PUT', path, h, o);
export const PATCH = (path: string, h: Handler, o?: Options) => route('PATCH', path, h, o);
export const DELETE = (path: string, h: Handler, o?: Options) => route('DELETE', path, h, o);

export function userByToken(token: string | null | undefined): UserRow | undefined {
  if (!token) return undefined;
  return get<UserRow>('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', token);
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

function readJson(req: IncomingMessage, limit = 512 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(fail(413, 'Conteúdo grande demais.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body && typeof body === 'object' ? body : {});
      } catch {
        reject(fail(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

export function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export async function handleApi(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      try {
        r.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
      } catch {
        throw fail(400, 'Endereço inválido.');
      }
      const token = bearer(req);
      const user = userByToken(token);
      if (!r.public && !user) throw fail(401, 'Sessão expirada. Entre de novo.');
      const hasBody = !r.raw && req.method !== 'GET' && req.method !== 'DELETE';
      const out = await r.handler({
        req,
        res,
        params,
        query: url.searchParams,
        body: hasBody ? await readJson(req) : {},
        user: user as UserRow,
        token,
        ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim(),
      });
      if (!res.writableEnded) json(res, 200, out ?? { ok: true });
      return;
    }
    throw fail(404, 'Rota não encontrada.');
  } catch (e) {
    if (res.writableEnded) return;
    if (e instanceof HttpError) json(res, e.status, { error: e.message });
    else {
      console.error(e);
      json(res, 500, { error: 'Erro interno do servidor.' });
    }
  }
}

/** Valida um texto vindo do cliente: tipo, tamanho mínimo e máximo. Devolve já sem espaços nas pontas. */
export function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== 'string') throw fail(400, `${label}: valor inválido.`);
  const out = value.trim();
  if (out.length < min) throw fail(400, min === 1 ? `${label} não pode ficar em branco.` : `${label} precisa de pelo menos ${min} caracteres.`);
  if (out.length > max) throw fail(400, `${label} passa de ${max} caracteres.`);
  return out;
}

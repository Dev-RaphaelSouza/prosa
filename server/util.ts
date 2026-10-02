import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const now = () => Date.now();

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
// Sem 0/o/1/l/i: o código de convite é lido e ditado por gente.
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function random(len: number, chars: string): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export const newId = () => random(14, ID_CHARS);
export const newCode = () => random(8, CODE_CHARS);
export const newToken = () => randomBytes(32).toString('base64url');

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return salt.toString('hex') + ':' + (await derive(password, salt)).toString('hex');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await derive(password, Buffer.from(salt, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// Limite de frequência em memória: chave → instantes das últimas chamadas.
const hits = new Map<string, number[]>();
export function allow(key: string, max: number, windowMs: number): boolean {
  const t = now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(t);
  hits.set(key, list);
  return true;
}
setInterval(() => {
  const t = now();
  for (const [key, list] of hits) if (!list.some((x) => t - x < 60_000)) hits.delete(key);
}, 60_000).unref();

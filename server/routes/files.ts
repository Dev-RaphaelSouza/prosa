import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { UPLOAD_DIR } from '../db.ts';
import { GET, POST, fail } from '../http.ts';
import { allow, newId } from '../util.ts';
import type { LinkPreview } from '../../shared/types.ts';

const MAX_UPLOAD = 25 * 1024 * 1024;

// O corpo do POST é o arquivo cru; nome e tipo vêm na query. Sem multipart, sem dependência.
POST(
  '/api/upload',
  (c) =>
    new Promise((resolve, reject) => {
      if (!allow('upload:' + c.user.id, 30, 60_000)) return reject(fail(429, 'Muitos envios em pouco tempo.'));
      const name = (c.query.get('name') ?? 'arquivo').slice(0, 120);
      const ext = (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? 'bin').toLowerCase();
      const declared = Number(c.req.headers['content-length']) || 0;
      if (declared > MAX_UPLOAD) return reject(fail(413, 'Arquivo grande demais (o limite é 25 MB).'));

      const file = `${newId()}${newId()}.${ext}`;
      const path = join(UPLOAD_DIR, file);
      const out = createWriteStream(path);
      let size = 0;
      let failed = false;
      const abort = (err: Error) => {
        if (failed) return;
        failed = true;
        out.destroy();
        void unlink(path).catch(() => {});
        reject(err);
      };
      c.req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_UPLOAD) {
          c.req.unpipe(out);
          c.req.resume();
          abort(fail(413, 'Arquivo grande demais (o limite é 25 MB).'));
        }
      });
      c.req.on('error', abort);
      c.req.on('aborted', () => abort(fail(400, 'Envio interrompido.')));
      out.on('error', abort);
      out.on('finish', () => {
        if (failed) return;
        if (!size) return abort(fail(400, 'Arquivo vazio.'));
        resolve({ url: `/uploads/${file}`, name, size, type: String(c.req.headers['content-type'] ?? 'application/octet-stream').slice(0, 80) });
      });
      c.req.pipe(out);
    }),
  { raw: true },
);

// ---------- prévia de link ----------

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
    return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** O servidor só busca endereço público: nada de rede interna, localhost ou esquema estranho. */
export async function isPublicUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return !isPrivateAddress(host);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();

function meta(html: string, ...names: string[]): string {
  for (const name of names) {
    const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0];
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decode(content);
  }
  return '';
}

const previews = new Map<string, { at: number; data: LinkPreview | null }>();

async function fetchPreview(raw: string): Promise<LinkPreview | null> {
  let url = raw;
  // Redirecionamento é seguido na mão, pra checar cada salto: um site público pode apontar pra rede interna.
  for (let hop = 0; hop < 4; hop++) {
    if (!(await isPublicUrl(url))) return null;
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProsaBot/1.0; +link-preview)', Accept: 'text/html' },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return null;
      url = new URL(next, url).href;
      continue;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html') || !res.body) return null;

    // Só o começo do documento: as tags que interessam ficam no <head>.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 300_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    void reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString('utf8');

    const title = meta(html, 'og:title', 'twitter:title') || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '');
    if (!title) return null;
    const image = meta(html, 'og:image', 'twitter:image');
    return {
      url,
      title: title.slice(0, 200),
      description: meta(html, 'og:description', 'description', 'twitter:description').slice(0, 300),
      image: image ? new URL(image, url).href : null,
      site: meta(html, 'og:site_name') || new URL(url).hostname.replace(/^www\./, ''),
    };
  }
  return null;
}

GET('/api/preview', async (c) => {
  const url = c.query.get('url') ?? '';
  if (url.length > 2000) throw fail(400, 'Endereço grande demais.');
  const cached = previews.get(url);
  if (cached && Date.now() - cached.at < 60 * 60_000) return { preview: cached.data };
  if (!allow('preview:' + c.user.id, 40, 60_000)) throw fail(429, 'Muitas prévias em pouco tempo.');
  const data = await fetchPreview(url).catch(() => null);
  if (previews.size > 2000) previews.clear();
  previews.set(url, { at: Date.now(), data });
  return { preview: data };
});

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { UPLOAD_DIR } from './db.ts';
import { features } from './core.ts';
import { attachGateway } from './gateway.ts';
import { handleApi } from './http.ts';
import './routes/auth.ts';
import './routes/servers.ts';
import './routes/messages.ts';
import './routes/social.ts';
import './routes/files.ts';

const PORT = Number(process.env.PORT ?? 3001);
// Sem HOST, escuta em todas as interfaces. Atrás de um túnel basta 127.0.0.1 (e o firewall nem pergunta).
const HOST = process.env.HOST || undefined;
const DIST = resolve(import.meta.dirname, '..', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

// De um upload só se mostra no navegador o que não executa nada: imagem, vídeo e áudio.
// O resto (html, svg, pdf…) sempre baixa como arquivo.
const INLINE_UPLOADS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.mp4', '.webm', '.mp3', '.ogg', '.wav', '.m4a']);

async function serveFile(req: IncomingMessage, res: ServerResponse, base: string, rel: string, upload: boolean): Promise<boolean> {
  const path = resolve(base, '.' + sep + rel);
  if (!path.startsWith(base + sep)) return false;
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;

  const ext = extname(path).toLowerCase();
  const inline = !upload || INLINE_UPLOADS.has(ext);
  const headers: Record<string, string | number> = {
    'Content-Type': inline ? (MIME[ext] ?? 'application/octet-stream') : 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    // Uploads e arquivos com hash no nome nunca mudam; o index.html sempre se revalida.
    'Cache-Control': upload || rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (!inline) headers['Content-Disposition'] = 'attachment';

  // Range: é o que deixa vídeo e áudio pularem pra frente sem baixar tudo.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
      return true;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    createReadStream(path, { start, end }).pipe(res);
    return true;
  }

  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const raw = new URL(req.url ?? '/', 'http://x').pathname;
    if (raw.startsWith('/api/')) return await handleApi(req, res);
    const path = decodeURIComponent(raw);
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
    if (path.startsWith('/uploads/')) {
      if (!(await serveFile(req, res, UPLOAD_DIR, path.slice(9), true))) res.writeHead(404).end();
      return;
    }
    // Produção: o front compilado sai daqui mesmo. Qualquer rota do app cai no index.html.
    if (existsSync(DIST)) {
      if (path !== '/' && (await serveFile(req, res, DIST, path.slice(1), false))) return;
      if (!extname(path) && (await serveFile(req, res, DIST, 'index.html', false))) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado.');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

attachGateway(server);

server.listen(PORT, HOST, () => {
  console.log(`Prosa no ar: http://localhost:${PORT}${existsSync(DIST) ? '' : '  (só a API — o front roda pelo Vite em http://localhost:5173)'}`);
  console.log(`Navegador da sala: ${features.browser ? 'disponível' : 'indisponível (nenhum Chrome/Edge encontrado)'}`);
});

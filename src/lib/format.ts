const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const longDay = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const full = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short' });

const dayStart = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);
const DAY = 86_400_000;

export const formatTime = (ts: number) => time.format(ts);
export const formatFull = (ts: number) => full.format(ts);
export const formatDate = (ts: number) => shortDay.format(ts);

export function formatDay(ts: number): string {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / DAY);
  return diff === 0 ? 'Hoje' : diff === 1 ? 'Ontem' : longDay.format(ts);
}

export function formatStamp(ts: number): string {
  const diff = Math.round((dayStart(Date.now()) - dayStart(ts)) / DAY);
  if (diff === 0) return 'hoje às ' + time.format(ts);
  if (diff === 1) return 'ontem às ' + time.format(ts);
  return `${shortDay.format(ts)} ${time.format(ts)}`;
}

export const sameDay = (a: number, b: number) => dayStart(a) === dayStart(b);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = ['#8f7bff', '#4cb7ff', '#2fd4a7', '#f5b942', '#ff7a59', '#ff6fae', '#7ad66d', '#5ad1e6'];

/** Cor estável pra quem não tem foto: sai do id, então é sempre a mesma pra mesma pessoa. */
export function colorOf(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export const STATUS_LABEL: Record<string, string> = {
  online: 'Disponível',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  invisible: 'Invisível',
  offline: 'Offline',
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

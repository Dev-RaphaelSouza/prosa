// Paleta que o servidor valida e o cliente pinta. As cores de fundo em si moram no CSS (data-bg).

export const ACCENTS = [
  { id: '#8f7bff', name: 'Íris' },
  { id: '#4cb7ff', name: 'Céu' },
  { id: '#2fd4a7', name: 'Menta' },
  { id: '#a3e635', name: 'Lima' },
  { id: '#f5b942', name: 'Âmbar' },
  { id: '#ff7a59', name: 'Coral' },
  { id: '#ff6fae', name: 'Rosa' },
  { id: '#d8dbe6', name: 'Neve' },
] as const;

export const BACKGROUNDS = [
  { id: 'noite', name: 'Noite', swatch: '#151722' },
  { id: 'grafite', name: 'Grafite', swatch: '#1c1c1f' },
  { id: 'breu', name: 'Breu', swatch: '#000000' },
  { id: 'aurora', name: 'Aurora', swatch: '#0f1e22' },
  { id: 'vinho', name: 'Vinho', swatch: '#21141c' },
  { id: 'claro', name: 'Claro', swatch: '#f4f5f8' },
] as const;

export const DEFAULT_ACCENT = ACCENTS[0].id;
export const DEFAULT_BG = BACKGROUNDS[0].id;

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const isBackground = (value: unknown): value is string => BACKGROUNDS.some((b) => b.id === value);

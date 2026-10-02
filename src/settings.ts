// Preferências que ficam só neste aparelho (localStorage): aparência, avisos, voz e atalhos.
import { create } from 'zustand';
import { DEFAULT_ACCENT, DEFAULT_BG } from '../shared/theme';

export type HotkeyAction = 'mute' | 'deafen' | 'camera' | 'screen' | 'hand' | 'leave';

export const HOTKEY_ACTIONS: { id: HotkeyAction; name: string }[] = [
  { id: 'mute', name: 'Ligar / desligar o microfone' },
  { id: 'deafen', name: 'Ligar / desligar o som da chamada' },
  { id: 'camera', name: 'Ligar / desligar a câmera' },
  { id: 'screen', name: 'Compartilhar / parar a tela' },
  { id: 'hand', name: 'Levantar / baixar a mão' },
  { id: 'leave', name: 'Sair da chamada' },
];

export interface Settings {
  accent: string;
  bg: string;
  density: 'confortavel' | 'compacta';
  scale: number;
  reducedMotion: boolean;
  /** Mostra forma além de cor nos indicadores (status, não lidas). */
  shapes: boolean;
  serverThemes: boolean;
  linkPreviews: boolean;
  notifyMentions: boolean;
  notifyDms: boolean;
  sounds: boolean;
  micId: string;
  camId: string;
  speakerId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  ptt: boolean;
  pttKey: string;
  hotkeys: Record<HotkeyAction, string>;
  /** Volume de cada pessoa na chamada, de 0 a 1. */
  volumes: Record<string, number>;
  /** Modo trabalho: lista compacta e avisos calados, com um interruptor só. */
  workMode: boolean;
  membersOpen: boolean;
  recentEmoji: string[];
}

const DEFAULTS: Settings = {
  accent: DEFAULT_ACCENT,
  bg: DEFAULT_BG,
  density: 'confortavel',
  scale: 15,
  reducedMotion: false,
  shapes: false,
  serverThemes: true,
  linkPreviews: true,
  notifyMentions: true,
  notifyDms: true,
  sounds: true,
  micId: '',
  camId: '',
  speakerId: '',
  noiseSuppression: true,
  echoCancellation: true,
  autoGain: true,
  ptt: false,
  pttKey: 'Backquote',
  hotkeys: { mute: 'Ctrl+Shift+M', deafen: 'Ctrl+Shift+D', camera: '', screen: '', hand: '', leave: '' },
  volumes: {},
  workMode: false,
  membersOpen: true,
  recentEmoji: ['👍', '❤️', '😂', '🔥', '😮', '🎉'],
};

const KEY = 'prosa.settings';

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...saved, hotkeys: { ...DEFAULTS.hotkeys, ...saved.hotkeys } };
  } catch {
    return DEFAULTS;
  }
}

export const useSettings = create<Settings>(() => load());

useSettings.subscribe((state) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sem armazenamento: vale só até recarregar */
  }
});

export const setSettings = (patch: Partial<Settings>) => useSettings.setState(patch);
export const settings = () => useSettings.getState();

/** Nome legível de uma combinação de teclas, no formato guardado em `hotkeys` ("Ctrl+Shift+M"). */
export function comboOf(e: KeyboardEvent): string {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.code.replace(/^Key|^Digit/, ''));
  return parts.join('+');
}

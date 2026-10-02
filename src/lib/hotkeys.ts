// Atalhos globais: Ctrl+K, os atalhos da chamada e o apertar-pra-falar.
import { HOTKEY_ACTIONS, comboOf, settings, type HotkeyAction } from '../settings';
import { ui, useApp } from '../store';
import { leaveVoice, setPtt, toggleCamera, toggleDeaf, toggleHand, toggleMute, toggleScreen, useVoice } from '../voice';

const ACTIONS: Record<HotkeyAction, () => void> = {
  mute: () => void toggleMute(),
  deafen: toggleDeaf,
  camera: () => void toggleCamera(),
  screen: () => void toggleScreen(),
  hand: toggleHand,
  leave: () => leaveVoice(),
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || el.tagName === 'CANVAS');
};

export function initHotkeys() {
  window.addEventListener('keydown', (e) => {
    if (useApp.getState().phase !== 'ready') return;
    const s = settings();

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      return ui((state) => ({ palette: !state.palette, menu: null, profile: null }));
    }

    const inCall = useVoice.getState().status === 'connected';
    if (inCall && s.ptt && e.code === s.pttKey && !isTyping(e.target)) {
      e.preventDefault();
      return setPtt(true);
    }
    if (e.repeat || !inCall) return;
    const combo = comboOf(e);
    if (!combo) return;
    // Atalho sem Ctrl/Alt/Meta é uma tecla comum: não pode disparar enquanto a pessoa escreve.
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (plain && isTyping(e.target)) return;
    const action = HOTKEY_ACTIONS.find((a) => s.hotkeys[a.id] === combo);
    if (action) {
      e.preventDefault();
      ACTIONS[action.id]();
    }
  });

  window.addEventListener('keyup', (e) => e.code === settings().pttKey && setPtt(false));
  window.addEventListener('blur', () => setPtt(false));
}

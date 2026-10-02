// Avisos: o do sistema (Notification) e os sons, sintetizados na hora — sem arquivo de áudio pra baixar.
import { settings } from '../settings';

type Sound = 'message' | 'join' | 'leave' | 'mute' | 'unmute' | 'done' | 'hand';

// [frequência em Hz, atraso em segundos]
const NOTES: Record<Sound, [number, number][]> = {
  message: [
    [880, 0],
    [1175, 0.09],
  ],
  join: [
    [523, 0],
    [784, 0.1],
  ],
  leave: [
    [784, 0],
    [523, 0.1],
  ],
  mute: [[330, 0]],
  unmute: [[494, 0]],
  hand: [[988, 0]],
  done: [
    [659, 0],
    [784, 0.13],
    [1047, 0.26],
  ],
};

let ctx: AudioContext | null = null;

export function playSound(kind: Sound) {
  const s = settings();
  if (!s.sounds || (s.workMode && kind === 'message')) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    for (const [freq, delay] of NOTES[kind]) {
      const at = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.07, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    }
  } catch {
    /* sem áudio disponível: fica sem som */
  }
}

export const canNotify = () => typeof Notification !== 'undefined';

export async function askNotifyPermission(): Promise<boolean> {
  if (!canNotify()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function systemNotify(title: string, body: string, icon?: string | null, onClick?: () => void) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body: body.slice(0, 180), icon: icon ?? '/icon.svg', tag: title });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* alguns navegadores móveis só notificam via service worker */
  }
}

export function notifyMessage(o: { title: string; body: string; icon?: string | null; dm: boolean; quiet: boolean; onClick: () => void }) {
  const s = settings();
  // Não perturbe e modo trabalho calam tudo; o contador de não lidas continua subindo.
  if (o.quiet || s.workMode || !(o.dm ? s.notifyDms : s.notifyMentions)) return;
  playSound('message');
  if (document.visibilityState !== 'visible' || !document.hasFocus()) systemNotify(o.title, o.body, o.icon, o.onClick);
}

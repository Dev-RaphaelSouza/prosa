// Aplica aparência no <html>: cor de destaque, fundo, densidade, escala e movimento.
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettings } from '../settings';
import { useCurrentServer } from '../store';
import { isBackground, isHexColor } from '../../shared/theme';

/** Texto sobre a cor de destaque: escuro em cor clara, branco em cor escura. */
function onAccent(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#14151c' : '#ffffff';
}

export function useTheme() {
  const s = useSettings(
    useShallow((x) => ({
      accent: x.accent,
      bg: x.bg,
      density: x.density,
      scale: x.scale,
      reducedMotion: x.reducedMotion,
      shapes: x.shapes,
      serverThemes: x.serverThemes,
      workMode: x.workMode,
    })),
  );
  const theme = useCurrentServer()?.theme;
  // O tema do servidor vale enquanto a pessoa está nele — a não ser que ela prefira o dela sempre.
  const accent = s.serverThemes && isHexColor(theme?.accent) ? theme.accent : s.accent;
  const bg = s.serverThemes && isBackground(theme?.bg) ? theme.bg : s.bg;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.bg = bg;
    root.dataset.density = s.workMode ? 'compacta' : s.density;
    root.dataset.motion = s.reducedMotion ? 'reduced' : 'full';
    root.dataset.shapes = s.shapes ? 'on' : 'off';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', onAccent(accent));
    root.style.fontSize = s.scale + 'px';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg-1').trim());
  }, [accent, bg, s.density, s.workMode, s.reducedMotion, s.shapes, s.scale]);
}

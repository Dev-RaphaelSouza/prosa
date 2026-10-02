// Painel flutuante preso a um botão (seletor de emoji, etc.), e o seletor de emoji em si.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EMOJI } from '../lib/emoji';
import { setSettings, useSettings } from '../settings';
import { cx } from './ui';

export function Popover({ anchor, onClose, children, className }: { anchor: DOMRect; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Mede o painel e o encaixa na tela: acima do botão se couber, senão abaixo.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const above = anchor.top - height - margin;
    const top = above >= margin ? above : Math.min(anchor.bottom + margin, innerHeight - height - margin);
    const left = Math.max(margin, Math.min(anchor.right - width, innerWidth - width - margin));
    setPos({ left, top: Math.max(margin, top) });
  }, [anchor]);

  return createPortal(
    <div className="popover-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div
        ref={ref}
        className={cx('popover', className)}
        style={pos ? pos : { visibility: 'hidden' }}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const recent = useSettings((s) => s.recentEmoji);
  const [tab, setTab] = useState(0);
  const pick = (emoji: string) => {
    setSettings({ recentEmoji: [emoji, ...recent.filter((e) => e !== emoji)].slice(0, 16) });
    onPick(emoji);
  };
  return (
    <div className="emoji-picker">
      <div className="emoji-tabs" role="tablist">
        {EMOJI.map((group, i) => (
          <button key={group.name} role="tab" aria-selected={i === tab} aria-label={group.name} data-tip={group.name} data-tip-pos="bottom" className={cx(i === tab && 'on')} onClick={() => setTab(i)}>
            {group.icon}
          </button>
        ))}
      </div>
      <div className="emoji-scroll">
        {tab === 0 && recent.length > 0 && (
          <>
            <div className="label">Recentes</div>
            <div className="emoji-grid">
              {recent.map((emoji) => (
                <button key={emoji} onClick={() => pick(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="label">{EMOJI[tab].name}</div>
        <div className="emoji-grid">
          {EMOJI[tab].list.map((emoji) => (
            <button key={emoji} onClick={() => pick(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

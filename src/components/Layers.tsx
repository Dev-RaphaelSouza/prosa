// O que flutua por cima de tudo: menu de contexto, avisos rápidos, imagem ampliada e confirmação.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { ui, useUi, type Modal as ModalState } from '../store';
import { Button, IconButton, Modal, cx, useAction } from './ui';

export function MenuLayer() {
  const menu = useUi((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return setPos(null);
    const { width, height } = el.getBoundingClientRect();
    // Abre a partir do ponto clicado, mas nunca pra fora da tela.
    setPos({
      left: Math.max(8, Math.min(menu.x, innerWidth - width - 8)),
      top: Math.max(8, menu.y + height > innerHeight - 8 ? menu.y - height : menu.y),
    });
    el.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  if (!menu) return null;
  const close = () => ui({ menu: null });

  return (
    <div className="popover-layer" onMouseDown={(e) => e.target === e.currentTarget && close()} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={pos ?? { visibility: 'hidden' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return close();
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];
          const next = items.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1);
          items[(next + items.length) % items.length]?.focus();
        }}
      >
        {menu.items.map((item, i) =>
          item.separator ? (
            <hr key={i} />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={cx(item.danger && 'danger')}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect?.();
              }}
            >
              <span className="grow">{item.label}</span>
              {item.icon}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.kind)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Lightbox() {
  const image = useUi((s) => s.lightbox);
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui({ lightbox: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [image]);
  if (!image) return null;
  return (
    <div className="scrim lightbox" onClick={() => ui({ lightbox: null })}>
      <img src={image.url} alt={image.name} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="truncate">{image.name}</span>
        <a className="icon-btn" href={image.url} download={image.name} aria-label="Baixar" data-tip="Baixar">
          <Download />
        </a>
        <IconButton label="Fechar" onClick={() => ui({ lightbox: null })}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}

export function ConfirmModal({ modal }: { modal: Extract<ModalState, { type: 'confirm' }> }) {
  const { busy, error, run } = useAction();
  const done = () => ui({ modal: modal.back ?? null });
  return (
    <Modal title={modal.title} onClose={done} size="small">
      <div className="modal-body">
        <p className="muted-2">{modal.body}</p>
        {error && <p className="error-text">{error}</p>}
      </div>
      <footer className="modal-foot">
        <Button variant="ghost" onClick={done}>
          Cancelar
        </Button>
        <Button variant={modal.danger ? 'danger' : 'primary'} loading={busy} autoFocus onClick={async () => (await run(async () => modal.onConfirm())) && done()}>
          {modal.action}
        </Button>
      </footer>
    </Modal>
  );
}

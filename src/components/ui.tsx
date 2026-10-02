// As peças pequenas que todas as telas usam.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { api, errorText } from '../api';
import { colorOf, initials } from '../lib/format';
import { ACCENTS } from '../../shared/theme';
import type { Server, Status, User } from '../../shared/types';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function Avatar({ user, size, status, speaking, ring }: { user: User; size?: string; status?: Status | false; speaking?: boolean; ring?: string }) {
  const style = { '--size': size, '--dot-ring': ring, background: user.avatar ? undefined : colorOf(user.id || user.handle) } as CSSProperties;
  return (
    <span className={cx('avatar', speaking && 'speaking')} style={style}>
      {user.avatar ? <img src={user.avatar} alt="" loading="lazy" draggable={false} /> : initials(user.name)}
      {status && <span className={'status-dot ' + status} />}
    </span>
  );
}

export function ServerIcon({ server }: { server: Pick<Server, 'name' | 'icon'> }) {
  return server.icon ? <img src={server.icon} alt="" draggable={false} /> : <span>{initials(server.name)}</span>;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'ghost' | 'soft-danger';
  small?: boolean;
  block?: boolean;
  loading?: boolean;
}

export function Button({ variant, small, block, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} className={cx('btn', variant, small && 'small', block && 'block', className)}>
      {loading ? <span className="spinner" /> : children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tip?: 'top' | 'right' | 'bottom' | 'left';
  on?: boolean;
  off?: boolean;
}

export function IconButton({ label, tip, on, off, className, children, ...rest }: IconButtonProps) {
  return (
    <button type="button" {...rest} aria-label={label} data-tip={label} data-tip-pos={tip} className={cx('icon-btn', on && 'on', off && 'off', className)}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (id: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} className={cx(o.id === value && 'on')} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Paleta de cores: as prontas e um seletor livre no fim. */
export function ColorPicker({ value, onChange, allowNone }: { value: string | null; onChange: (color: string | null) => void; allowNone?: boolean }) {
  const custom = !!value && !ACCENTS.some((a) => a.id === value);
  return (
    <div className="swatches">
      {allowNone && (
        <button type="button" className={cx('swatch', !value && 'on')} style={{ background: 'var(--bg-4)' }} onClick={() => onChange(null)} data-tip="Padrão">
          <X size={14} />
        </button>
      )}
      {ACCENTS.map((a) => (
        <button key={a.id} type="button" className={cx('swatch', value === a.id && 'on')} style={{ background: a.id }} onClick={() => onChange(a.id)} data-tip={a.name} aria-label={a.name} />
      ))}
      <input
        type="color"
        className={cx('swatch', custom && 'on')}
        value={value ?? '#8f7bff'}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Outra cor"
        style={custom ? { background: value! } : undefined}
      />
    </div>
  );
}

/** Uma linha de ajuste: título e explicação à esquerda, controle à direita. */
export function Setting({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="grow">
        <div className="setting-title">{title}</div>
        {desc && <div className="hint">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, size, bare }: { title?: string; onClose: () => void; children: ReactNode; size?: 'small' | 'wide' | 'full'; bare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // O foco entra no modal (no primeiro campo, se houver) e volta pra onde estava ao fechar.
    const target = ref.current?.querySelector<HTMLElement>('[autofocus], input:not([type=file]), textarea') ?? ref.current;
    target?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={cx('modal', size, bare && 'bare')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {title && (
          <header className="modal-head">
            <h2>{title}</h2>
            <IconButton label="Fechar" tip="left" onClick={onClose}>
              <X />
            </IconButton>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

/** Estado de uma ação assíncrona de formulário: carregando e mensagem de erro. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/** Lê largura e altura de uma imagem antes de enviar, pra reservar o espaço certo na conversa. */
export function imageSize(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Botão de trocar imagem (avatar, ícone do servidor): escolhe, valida, envia e devolve a URL. */
export function ImageUpload({ children, onUploaded, onError }: { children: ReactNode; onUploaded: (url: string) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={cx('image-upload', busy && 'busy')}>
      {children}
      {busy && <span className="spinner" />}
      <input
        type="file"
        accept={IMAGE_TYPES.join(',')}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (!IMAGE_TYPES.includes(file.type)) return onError('Use PNG, JPG, GIF ou WebP.');
          if (file.size > 8 * 1024 * 1024) return onError('A imagem passa de 8 MB.');
          setBusy(true);
          try {
            onUploaded((await api.upload(file, file.name)).url);
          } catch (err) {
            onError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="var(--accent)" />
      <path
        fill="var(--on-accent)"
        d="M20 17h24a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H33.5l-8.9 7.1a1.6 1.6 0 0 1-2.6-1.25V45H20a8 8 0 0 1-8-8V25a8 8 0 0 1 8-8z"
      />
      <g fill="var(--accent)">
        <circle cx="24" cy="31" r="3" />
        <circle cx="32" cy="31" r="3" />
        <circle cx="40" cy="31" r="3" />
      </g>
    </svg>
  );
}

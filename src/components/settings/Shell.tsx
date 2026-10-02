// A moldura dos ajustes (da pessoa e do servidor): navegação à esquerda, seção à direita.
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton, Modal, cx } from '../ui';

export interface SettingsTab {
  id: string;
  name: string;
  icon: ReactNode;
  danger?: boolean;
}

export function SettingsShell({
  title,
  tabs,
  tab,
  onTab,
  onClose,
  children,
  footer,
}: {
  title: string;
  tabs: SettingsTab[];
  tab: string;
  onTab: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  return (
    <Modal onClose={onClose} size="full" bare>
      <div className="settings" aria-label={title}>
        <nav className="settings-nav" aria-label={`Seções de ${title}`}>
          <div className="label">{title}</div>
          {tabs.map((t) => (
            <button key={t.id} className={cx('chan', t.id === current.id && 'active', t.danger && 'danger')} onClick={() => onTab(t.id)}>
              {t.icon}
              <span className="grow truncate">{t.name}</span>
            </button>
          ))}
          {footer}
        </nav>
        <section className="settings-main">
          <header className="settings-head">
            <h2>{current.name}</h2>
            <IconButton label="Fechar (Esc)" tip="left" onClick={onClose}>
              <X />
            </IconButton>
          </header>
          <div className="settings-body" key={current.id}>
            {children}
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="group">
      {title && <div className="label">{title}</div>}
      <div className="group-box">{children}</div>
    </div>
  );
}

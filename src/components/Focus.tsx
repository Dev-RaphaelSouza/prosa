// Sessão de foco do servidor: um cronômetro e uma lista de tarefas que todo mundo vê igual.
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Coffee, Play, Plus, Square, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { formatClock } from '../lib/format';
import { useNow } from '../lib/hooks';
import { playSound, systemNotify } from '../lib/notify';
import { setSettings, useSettings } from '../settings';
import { toast, toastError, ui, useApp, useCurrentServer, useUi } from '../store';
import { Button, IconButton, Toggle, cx } from './ui';
import type { Server } from '../../shared/types';

/** Avisa quando o foco ou a pausa de qualquer servidor seu chega ao fim, com o painel aberto ou não. */
export function FocusWatcher() {
  const servers = useApp((s) => s.servers);
  // Só os prazos importam: assim os temporizadores não são refeitos a cada mudança de presença.
  const deadlines = JSON.stringify(
    Object.values(servers)
      .filter((s) => s.focus.endsAt && s.focus.phase !== 'idle')
      .map((s) => [s.name, s.focus.phase, s.focus.endsAt]),
  );

  useEffect(() => {
    const timers = (JSON.parse(deadlines) as [string, string, number][]).map(([name, phase, endsAt]) => {
      const wait = endsAt - Date.now();
      if (wait <= 0) return undefined;
      return setTimeout(() => {
        const text = phase === 'foco' ? 'Sessão de foco concluída. Hora da pausa.' : 'A pausa acabou.';
        playSound('done');
        toast(`${name}: ${text}`, 'ok');
        if (!document.hasFocus()) systemNotify(name, text);
      }, wait);
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [deadlines]);
  return null;
}

function Panel({ server }: { server: Server }) {
  const { focus } = server;
  const users = useApp((s) => s.users);
  const workMode = useSettings((s) => s.workMode);
  const running = focus.phase !== 'idle' && !!focus.endsAt;
  const now = useNow(running);
  const [task, setTask] = useState('');
  const [config, setConfig] = useState(false);

  const act = (action: string, extra: object = {}) => api.post(`/api/servers/${server.id}/focus`, { action, ...extra }).catch(toastError);
  const total = (focus.phase === 'pausa' ? focus.breakMin : focus.focusMin) * 60_000;
  const left = running ? Math.max(0, focus.endsAt! - now) : total;
  const over = running && left === 0;
  const progress = running ? 1 - left / total : 0;
  const R = 54;
  const C = 2 * Math.PI * R;

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;
    void act('task.add', { text: task });
    setTask('');
  };

  return (
    <div className="focus" role="dialog" aria-label="Sessão de foco">
      <header>
        <b className="grow">Sessão de foco</b>
        <span className="muted truncate">{server.name}</span>
        <IconButton label="Fechar a sessão de foco" tip="left" onClick={() => ui({ focusOpen: false })}>
          <X />
        </IconButton>
      </header>

      <div className={cx('focus-dial', focus.phase)}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={R} className="track" />
          <circle cx="60" cy="60" r={R} className="bar" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
        <div>
          <strong>{formatClock(left)}</strong>
          <small>{focus.phase === 'idle' ? 'pronto pra começar' : over ? (focus.phase === 'foco' ? 'foco concluído' : 'pausa encerrada') : focus.phase === 'foco' ? `foco · rodada ${focus.round}` : 'pausa'}</small>
        </div>
      </div>

      <div className="focus-actions">
        {(focus.phase === 'idle' || (focus.phase === 'pausa' && over)) && (
          <Button variant="primary" onClick={() => act('start')}>
            <Play /> Começar foco
          </Button>
        )}
        {focus.phase === 'foco' && over && (
          <Button variant="primary" onClick={() => act('break')}>
            <Coffee /> Começar pausa
          </Button>
        )}
        {running && !over && focus.phase === 'foco' && (
          <Button onClick={() => act('break')}>
            <Coffee /> Pausa
          </Button>
        )}
        {running && !over && focus.phase === 'pausa' && (
          <Button onClick={() => act('start')}>
            <Play /> Voltar ao foco
          </Button>
        )}
        {focus.phase !== 'idle' && (
          <Button variant="ghost" onClick={() => act('stop')}>
            <Square /> Encerrar
          </Button>
        )}
        {focus.phase === 'idle' && (
          <Button variant="ghost" onClick={() => setConfig(!config)}>
            {focus.focusMin} / {focus.breakMin} min
          </Button>
        )}
      </div>

      {config && focus.phase === 'idle' && (
        <div className="focus-config">
          <label>
            Foco
            <input className="input" type="number" min={1} max={180} defaultValue={focus.focusMin} onBlur={(e) => act('config', { focusMin: e.target.value, breakMin: focus.breakMin })} /> min
          </label>
          <label>
            Pausa
            <input className="input" type="number" min={1} max={60} defaultValue={focus.breakMin} onBlur={(e) => act('config', { focusMin: focus.focusMin, breakMin: e.target.value })} /> min
          </label>
        </div>
      )}

      <div className="focus-tasks">
        <div className="row">
          <span className="label grow">Tarefas da sala</span>
          {focus.tasks.some((t) => t.done) && (
            <button className="link" onClick={() => act('task.clear')}>
              limpar feitas
            </button>
          )}
        </div>
        {focus.tasks.length === 0 && <p className="hint">O que cada um vai fazer nesta sessão? Todo mundo do servidor vê a mesma lista.</p>}
        {focus.tasks.map((t) => (
          <div key={t.id} className={cx('task', t.done && 'done')}>
            <button className="task-check" role="checkbox" aria-checked={t.done} aria-label={t.text} onClick={() => act('task.toggle', { id: t.id })}>
              {t.done && <Check />}
            </button>
            <span className="grow">
              {t.text}
              <small> · {users[t.by]?.name ?? 'alguém'}</small>
            </span>
            <button className="task-remove" aria-label={`Remover ${t.text}`} onClick={() => act('task.remove', { id: t.id })}>
              <Trash2 />
            </button>
          </div>
        ))}
        <form className="task-add" onSubmit={add}>
          <Plus />
          <input value={task} maxLength={120} onChange={(e) => setTask(e.target.value)} placeholder="Nova tarefa" aria-label="Nova tarefa" />
        </form>
      </div>

      <label className="focus-work">
        <span className="grow">
          <b>Modo trabalho</b>
          <small>lista compacta e avisos calados, só pra você</small>
        </span>
        <Toggle label="Modo trabalho" checked={workMode} onChange={(on) => setSettings({ workMode: on })} />
      </label>
    </div>
  );
}

export function FocusPanel() {
  const open = useUi((s) => s.focusOpen);
  const server = useCurrentServer();
  return open && server ? <Panel server={server} /> : null;
}

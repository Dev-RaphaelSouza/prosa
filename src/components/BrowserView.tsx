// O navegador da sala: a imagem chega em quadros JPEG pelo gateway e é pintada num canvas;
// mouse e teclado de quem dirige vão de volta pro servidor.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Hand, Lock, RotateCw, Users, X } from 'lucide-react';
import { api } from '../api';
import { gateway } from '../gateway';
import { colorOf } from '../lib/format';
import { toastError, useApp, useMe } from '../store';
import { Avatar, Button, IconButton, cx } from './ui';
import { P, permsOf } from '../../shared/perms';
import type { BrowserState, Channel, DriveMode, Server } from '../../shared/types';

const MODE_LABEL: Record<DriveMode, string> = { livre: 'Mãos juntas', volante: 'Volante', poder: 'Só moderação' };

const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

interface Cursor {
  x: number;
  y: number;
  at: number;
}

export function BrowserView({ channel, server, state }: { channel: Channel; server: Server; state: BrowserState }) {
  const me = useMe();
  const users = useApp((s) => s.users);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [address, setAddress] = useState(state.url);
  const [editing, setEditing] = useState(false);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const lastMove = useRef(0);

  const isMod = (permsOf(server, me.id) & P.BROWSER) !== 0;
  const mode = channel.driveMode;
  const driving = mode === 'livre' || (mode === 'poder' ? isMod : state.driver === me.id);
  // No volante sem dono, a primeira ação pega a vez (o servidor decide; aqui só deixamos tentar).
  const mayAct = driving || (mode === 'volante' && !state.driver);
  const queued = state.queue.indexOf(me.id);

  // Pinta cada quadro que chega. A decodificação é assíncrona: um quadro velho nunca passa por cima de um novo.
  useEffect(() => {
    let seq = 0;
    let drawn = 0;
    return gateway.on('browser.frame', async (data: ArrayBuffer) => {
      const id = ++seq;
      try {
        const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
        const el = canvas.current;
        if (el && id > drawn) {
          drawn = id;
          el.getContext('2d')?.drawImage(bitmap, 0, 0, el.width, el.height);
        }
        bitmap.close();
      } catch {
        /* quadro corrompido: o próximo conserta */
      }
    });
  }, []);

  // Cursores dos outros: aparecem enquanto a pessoa mexe e somem sozinhos.
  useEffect(() => {
    const off = gateway.on('browser.cursor', ({ userId, x, y }: { userId: string; x: number; y: number }) => setCursors((c) => ({ ...c, [userId]: { x, y, at: Date.now() } })));
    const sweep = setInterval(() => setCursors((c) => (Object.values(c).some((v) => Date.now() - v.at > 2500) ? Object.fromEntries(Object.entries(c).filter(([, v]) => Date.now() - v.at <= 2500)) : c)), 1000);
    return () => {
      off();
      clearInterval(sweep);
    };
  }, []);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  // A roda do mouse precisa de um listener não passivo pra não rolar a página junto.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      gateway.send('browser.mouse', { type: 'wheel', ...point(e), dx: e.deltaX, dy: e.deltaY, mods: mods(e) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const mouse = (type: 'move' | 'down' | 'up') => (e: MouseEvent<HTMLCanvasElement>) => {
    if (type === 'move') {
      if (!driving || performance.now() - lastMove.current < 33) return;
      lastMove.current = performance.now();
    } else {
      if (!mayAct) return;
      e.preventDefault();
      if (type === 'down') canvas.current?.focus();
    }
    gateway.send('browser.mouse', { type, ...point(e), button: e.button, buttons: e.buttons, clicks: e.detail || 1, mods: mods(e) });
  };

  const key = (type: 'down' | 'up') => (e: KeyboardEvent<HTMLCanvasElement>) => {
    // Ctrl+K (comandos) continua sendo do app; colar passa pelo evento de paste, que tem o texto.
    const shortcut = e.ctrlKey || e.metaKey;
    if (!mayAct || (shortcut && ['k', 'v'].includes(e.key.toLowerCase()))) return;
    e.preventDefault();
    e.stopPropagation();
    const text = e.key.length === 1 && !shortcut ? e.key : e.key === 'Enter' ? '\r' : '';
    gateway.send('browser.key', { type, key: e.key, code: e.code, keyCode: e.keyCode, text, mods: mods(e) });
  };

  const nav = (payload: object) => gateway.send('browser.nav', payload);
  const wheel = (action: string, userId?: string) => gateway.send('browser.wheel', { action, userId });
  const driver = state.driver ? users[state.driver] : undefined;

  return (
    <div className="browser">
      <div className="browser-bar">
        <IconButton label="Voltar" tip="bottom" disabled={!mayAct} onClick={() => nav({ action: 'back' })}>
          <ArrowLeft />
        </IconButton>
        <IconButton label="Avançar" tip="bottom" disabled={!mayAct} onClick={() => nav({ action: 'forward' })}>
          <ArrowRight />
        </IconButton>
        <IconButton label="Recarregar" tip="bottom" disabled={!mayAct} onClick={() => nav({ action: 'reload' })}>
          <RotateCw className={cx(state.loading && 'spin')} />
        </IconButton>
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim()) nav({ url: address });
            setEditing(false);
            canvas.current?.focus();
          }}
        >
          <input
            value={editing ? address : state.url}
            title={state.title}
            disabled={!mayAct}
            onFocus={(e) => {
              setEditing(true);
              setAddress(state.url);
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Digite um endereço ou uma busca"
            aria-label="Endereço"
            spellCheck={false}
          />
        </form>

        {/* Quem modera já vê o modo no seletor ao lado; o selo só repete quando informa quem está dirigindo. */}
        {(!isMod || mode === 'volante') && (
          <div className={cx('browser-mode', driving && 'driving')} data-tip={mode === 'livre' ? 'Todo mundo na chamada dirige' : mode === 'volante' ? 'Um por vez dirige' : 'Só quem modera o navegador dirige'} data-tip-pos="bottom">
            {mode === 'livre' ? <Users /> : mode === 'poder' ? <Lock /> : driver ? <Avatar user={driver} size="1.3rem" /> : <Hand />}
            <span>{mode === 'volante' ? (driver ? (driver.id === me.id ? 'Você dirige' : `${driver.name} dirige`) : 'Volante livre') : MODE_LABEL[mode]}</span>
          </div>
        )}

        {mode === 'volante' &&
          (state.driver === me.id ? (
            <Button small onClick={() => wheel('release')}>
              Soltar{state.queue.length > 0 && ` · ${users[state.queue[0]]?.name ?? 'próximo'} é o próximo`}
            </Button>
          ) : queued >= 0 ? (
            <Button small onClick={() => wheel('cancel')}>
              Na fila ({queued + 1}º) · desistir
            </Button>
          ) : (
            <Button small variant="primary" onClick={() => wheel('request')}>
              {state.driver ? 'Pedir a vez' : 'Pegar o volante'}
            </Button>
          ))}
        {mode === 'volante' && isMod && state.driver && state.driver !== me.id && (
          <Button small variant="ghost" onClick={() => wheel('take')}>
            Tomar
          </Button>
        )}
        {isMod && (
          <select className="input browser-select" value={mode} aria-label="Quem dirige" onChange={(e) => api.patch(`/api/channels/${channel.id}`, { driveMode: e.target.value }).catch(toastError)}>
            {(Object.keys(MODE_LABEL) as DriveMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        )}
        {isMod && (
          <IconButton label="Fechar o navegador" tip="left" onClick={() => gateway.send('browser.close')}>
            <X />
          </IconButton>
        )}
      </div>

      <div className="browser-screen">
        <div className="browser-frame" style={{ aspectRatio: `${state.width} / ${state.height}` }}>
          <canvas
            ref={canvas}
            width={state.width}
            height={state.height}
            tabIndex={0}
            className={cx(mayAct ? 'can-drive' : 'watching')}
            aria-label={`Navegador da sala: ${state.title || state.url}`}
            onMouseMove={mouse('move')}
            onMouseDown={mouse('down')}
            onMouseUp={mouse('up')}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={key('down')}
            onKeyUp={key('up')}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (mayAct && text) gateway.send('browser.paste', { text });
            }}
          />
          {Object.entries(cursors).map(([userId, c]) => (
            <span key={userId} className="browser-cursor" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, color: colorOf(userId) }}>
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path d="M2 1l11 6-5 1.5L6 14z" fill="currentColor" stroke="#fff" strokeWidth="1" />
              </svg>
              <b>
                <span>{users[userId]?.name ?? '…'}</span>
              </b>
            </span>
          ))}
        </div>
      </div>
      <p className="browser-note">A sala vê a imagem do navegador, sem o som da página. Pra som junto, compartilhe a tela com o áudio da aba.</p>
    </div>
  );
}

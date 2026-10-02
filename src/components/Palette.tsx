// Buscar e comandos (Ctrl+K): pula pra qualquer canal ou conversa e dispara as ações mais usadas.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Briefcase,
  Globe,
  Hand,
  Hash,
  Headphones,
  LogOut,
  MessageCircle,
  Mic,
  Palette as PaletteIcon,
  PhoneOff,
  Plus,
  Search,
  Settings,
  Timer,
  UserPlus,
  Users,
  Volume2,
} from 'lucide-react';
import { openDm, SETTINGS_PERMS } from '../actions';
import { gateway } from '../gateway';
import { setSettings, settings } from '../settings';
import { findChannel, goChannel, goDm, goHome, openModal, signOut, ui, useApp, useUi } from '../store';
import { leaveVoice, toggleDeaf, toggleHand, toggleMute, useVoice } from '../voice';
import { Avatar, Modal, cx } from './ui';
import { P, permsOf } from '../../shared/perms';

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  group: string;
  /** Texto extra que a busca também considera. */
  keywords?: string;
  run: () => void;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function buildItems(query: string): Item[] {
  const s = useApp.getState();
  const v = useVoice.getState();
  const me = s.me!;
  const items: Item[] = [];
  const server = s.route.page === 'server' ? s.servers[s.route.serverId] : undefined;
  const perms = server ? permsOf(server, me.id) : 0;

  // Na chamada, os comandos dela vêm primeiro.
  if (v.channelId) {
    const call = findChannel(v.channelId);
    const browser = s.browsers[v.channelId];
    if (browser && /^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(query.trim()))
      items.push({ id: 'sala:abrir', label: `Abrir ${query.trim()} no navegador da sala`, icon: <Globe />, group: 'Chamada', keywords: query, run: () => gateway.send('browser.nav', { url: query.trim() }) });
    items.push(
      { id: 'sala:mudo', label: v.muted ? 'Ligar o microfone' : 'Desligar o microfone', icon: <Mic />, group: 'Chamada', keywords: 'mutar mudo mic', run: () => void toggleMute() },
      { id: 'sala:surdo', label: v.deaf ? 'Ligar o som da sala' : 'Desligar o som da sala', icon: <Headphones />, group: 'Chamada', keywords: 'surdo fone', run: toggleDeaf },
      { id: 'sala:mao', label: v.hand ? 'Baixar a mão' : 'Levantar a mão', icon: <Hand />, group: 'Chamada', run: toggleHand },
    );
    if (browser) {
      if (browser.driver === me.id) items.push({ id: 'sala:passar', label: 'Soltar o volante do navegador', hint: 'passa pro próximo da fila', icon: <Globe />, group: 'Chamada', run: () => gateway.send('browser.wheel', { action: 'release' }) });
      else items.push({ id: 'sala:pedir', label: 'Pedir o volante do navegador', hint: 'entra na fila da sala', icon: <Globe />, group: 'Chamada', run: () => gateway.send('browser.wheel', { action: 'request' }) });
    }
    if (call) items.push({ id: 'sala:ir', label: 'Ir pra chamada', hint: call.name, icon: <Volume2 />, group: 'Chamada', run: () => (call.serverId ? goChannel(call.serverId, call.id) : goDm(call.id)) });
    items.push({ id: 'sala:sair', label: 'Sair da chamada', icon: <PhoneOff />, group: 'Chamada', keywords: 'desligar', run: () => leaveVoice() });
  }

  for (const sv of Object.values(s.servers))
    for (const c of sv.channels) {
      const unread = s.unread[c.id]?.count;
      const people = Object.keys(s.voice[c.id] ?? {}).length;
      items.push({
        id: 'c:' + c.id,
        label: c.name,
        hint: [sv.name, unread ? `${unread} não lidas` : '', people ? `${people} na chamada` : ''].filter(Boolean).join(' · '),
        icon: c.kind === 'voice' ? <Volume2 /> : <Hash />,
        group: 'Canais',
        keywords: sv.name,
        run: () => goChannel(sv.id, c.id),
      });
    }

  for (const dm of Object.values(s.dms)) {
    const user = s.users[dm.recipientId ?? ''];
    if (user) items.push({ id: 'd:' + dm.id, label: user.name, hint: '@' + user.handle, icon: <Avatar user={user} size="1.4rem" />, group: 'Conversas', keywords: user.handle, run: () => goDm(dm.id) });
  }
  for (const f of Object.values(s.friends)) {
    const user = s.users[f.userId];
    if (user && f.status === 'accepted' && !Object.values(s.dms).some((d) => d.recipientId === user.id))
      items.push({ id: 'f:' + user.id, label: user.name, hint: 'começar conversa', icon: <Avatar user={user} size="1.4rem" />, group: 'Conversas', keywords: user.handle, run: () => void openDm(user.id) });
  }

  items.push({ id: 'ir:amigos', label: 'Amigos', icon: <Users />, group: 'Ir para', keywords: 'inicio mensagens', run: goHome });
  if (server) {
    items.push({ id: 'srv:foco', label: 'Abrir a sessão de foco', hint: 'cronômetro e tarefas da sala', icon: <Timer />, group: server.name, keywords: 'pomodoro', run: () => ui({ focusOpen: true }) });
    if (perms & P.INVITE) items.push({ id: 'srv:convidar', label: 'Convidar alguém', icon: <UserPlus />, group: server.name, keywords: 'convite link', run: () => openModal({ type: 'invite', serverId: server.id }) });
    if (perms & P.MANAGE_CHANNELS) items.push({ id: 'srv:canal', label: 'Criar canal', icon: <Plus />, group: server.name, keywords: 'novo', run: () => openModal({ type: 'createChannel', serverId: server.id }) });
    if (perms & SETTINGS_PERMS)
      items.push({ id: 'srv:cfg', label: 'Ajustes do servidor', hint: 'canais, cargos, convites', icon: <Settings />, group: server.name, keywords: 'configuracao permissoes', run: () => openModal({ type: 'serverSettings', serverId: server.id }) });
  }
  items.push(
    { id: 'app:servidor', label: 'Criar ou entrar num servidor', icon: <Plus />, group: 'Prosa', keywords: 'novo convite', run: () => openModal({ type: 'createServer' }) },
    { id: 'app:trabalho', label: settings().workMode ? 'Sair do modo trabalho' : 'Entrar no modo trabalho', hint: 'lista compacta, avisos calados', icon: <Briefcase />, group: 'Prosa', keywords: 'concentracao silencio', run: () => setSettings({ workMode: !settings().workMode }) },
    { id: 'app:aparencia', label: 'Aparência', hint: 'cores, fundo, densidade', icon: <PaletteIcon />, group: 'Prosa', keywords: 'tema', run: () => openModal({ type: 'userSettings', tab: 'aparencia' }) },
    { id: 'app:ajustes', label: 'Ajustes', hint: 'perfil, avisos, voz, atalhos', icon: <Settings />, group: 'Prosa', keywords: 'configuracao', run: () => openModal({ type: 'userSettings' }) },
    { id: 'app:mensagens', label: 'Mensagens e amigos', icon: <MessageCircle />, group: 'Prosa', run: goHome },
    { id: 'app:sair', label: 'Sair da conta', icon: <LogOut />, group: 'Prosa', keywords: 'logout trocar', run: () => signOut() },
  );

  const q = fold(query.trim());
  if (!q) return items;
  const words = q.split(/\s+/);
  const found = items
    .map((item) => {
      const text = fold(`${item.label} ${item.keywords ?? ''} ${item.group}`);
      if (!words.every((w) => text.includes(w))) return null;
      // Quem começa com o que foi digitado sobe; o resto mantém a ordem.
      return { item, score: fold(item.label).startsWith(q) ? 0 : fold(item.label).includes(q) ? 1 : 2 };
    })
    .filter((x): x is { item: Item; score: number } => !!x)
    .sort((a, b) => a.score - b.score);

  // O grupo com o melhor resultado vem primeiro e os itens do mesmo grupo ficam juntos:
  // senão o cabeçalho de um grupo se repete cada vez que a ordem por relevância o interrompe.
  const best = new Map<string, number>();
  for (const { item, score } of found) if (!best.has(item.group)) best.set(item.group, score);
  const groups = [...best.keys()];
  return found
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => groups.indexOf(a.item.group) - groups.indexOf(b.item.group) || a.i - b.i)
    .map((x) => x.item);
}

function PaletteBody() {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const items = useMemo(() => buildItems(query).slice(0, 60), [query]);
  const close = () => ui({ palette: false });

  useEffect(() => setIndex(0), [query]);
  // Com chaves de propósito: scrollIntoView pode devolver uma Promise, e um efeito só pode devolver função de limpeza.
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  let group = '';
  return (
    <Modal onClose={close} bare size="wide">
      <div
        className="palette"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            run(items[index]);
          }
        }}
      >
        <div className="palette-input">
          <Search />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar canal, pessoa ou comando" aria-label="Buscar canal, pessoa ou comando" />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={list} role="listbox">
          {items.length === 0 && <p className="muted palette-empty">Nada com “{query}”.</p>}
          {items.map((item, i) => {
            const header = item.group !== group ? (group = item.group) : null;
            return (
              <div key={item.id}>
                {header && <div className="label">{header}</div>}
                <button role="option" aria-selected={i === index} className={cx('palette-item', i === index && 'on')} onMouseMove={() => i !== index && setIndex(i)} onClick={() => run(item)}>
                  <span className="palette-icon">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                  {item.hint && <small className="truncate grow">{item.hint}</small>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

export function Palette() {
  const open = useUi((s) => s.palette);
  return open ? <PaletteBody /> : null;
}

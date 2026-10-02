// A conversa: cabeçalho, lista de mensagens, quem está digitando e o campo de escrever.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import {
  ArrowDown,
  ArrowRight,
  AtSign,
  Copy,
  CornerUpRight,
  Download,
  FileText,
  Hash,
  Menu,
  MoreHorizontal,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  Reply,
  Search,
  SendHorizontal,
  Smile,
  SmilePlus,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { api } from '../api';
import { copyText } from '../actions';
import { gateway } from '../gateway';
import { QUICK_REACTIONS, isJumbo } from '../lib/emoji';
import { formatBytes, formatDay, formatFull, formatStamp, formatTime, sameDay } from '../lib/format';
import { useFetch, usePreview } from '../lib/hooks';
import { firstUrl, renderContent, type ContentContext } from '../lib/markdown';
import { setSettings, useSettings } from '../settings';
import {
  discardFailed,
  loadMessages,
  loadOlder,
  markRead,
  openMenu,
  openModal,
  openProfile,
  roleColor,
  sendMessage,
  toast,
  toastError,
  ui,
  useApp,
  useMe,
  useUi,
  useUser,
  type ClientMessage,
  type MenuItem,
} from '../store';
import { joinVoice } from '../voice';
import { EmojiPicker, Popover } from './Popover';
import { Avatar, IconButton, cx, imageSize } from './ui';
import { P, permsOf } from '../../shared/perms';
import type { Attachment, Channel, Message, Server, User } from '../../shared/types';

const MAX_LENGTH = 4000;
const MAX_FILE = 25 * 1024 * 1024;

export function jumpToMessage(id: number) {
  const el = document.querySelector(`[data-mid="${id}"]`);
  if (!el) return toast('Essa mensagem está mais pra cima no histórico.');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}

const setReply = (msg: ClientMessage | undefined, channelId: string) => ui((s) => ({ reply: { ...s.reply, [channelId]: msg } }));

// ---------- anexos e prévia de link ----------

const kindOf = (a: Attachment) => {
  const ext = a.url.split('.').pop() ?? '';
  if (a.type.startsWith('image/') && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) return 'audio';
  return 'file';
};

function AttachmentView({ a }: { a: Attachment }) {
  const kind = kindOf(a);
  if (kind === 'image') {
    // Com largura e altura conhecidas o espaço já fica reservado: a conversa não pula quando a imagem chega.
    const scale = a.w && a.h ? Math.min(1, 420 / a.w, 320 / a.h) : 0;
    const style = a.w && a.h ? { aspectRatio: `${a.w} / ${a.h}`, width: Math.round(a.w * scale) } : undefined;
    return (
      <button className="att-image" style={style} onClick={() => ui({ lightbox: a })} aria-label={`Abrir ${a.name}`}>
        <img src={a.url} alt={a.name} loading="lazy" />
      </button>
    );
  }
  if (kind === 'video') return <video className="att-video" src={a.url} controls preload="metadata" />;
  return (
    <div className="att-file">
      <FileText />
      <div className="grow">
        <a href={a.url} download={a.name} className="truncate">
          {a.name}
        </a>
        <small>{formatBytes(a.size)}</small>
        {kind === 'audio' && <audio src={a.url} controls preload="none" />}
      </div>
      <a className="icon-btn" href={a.url} download={a.name} aria-label="Baixar" data-tip="Baixar">
        <Download />
      </a>
    </div>
  );
}

function LinkCard({ url }: { url: string }) {
  const preview = usePreview(url);
  if (!preview) return null;
  return (
    <a className="link-card" href={preview.url} target="_blank" rel="noopener noreferrer">
      <div className="grow">
        <small>{preview.site}</small>
        <b>{preview.title}</b>
        {preview.description && <p>{preview.description}</p>}
      </div>
      {preview.image && <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
    </a>
  );
}

// ---------- uma mensagem ----------

function EditBox({ msg }: { msg: ClientMessage }) {
  const [text, setText] = useState(msg.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = async () => {
    const content = text.trim();
    if (content === msg.content) return ui({ editing: null });
    if (!content && !msg.attachments.length) return toast('A mensagem não pode ficar vazia. Pra remover, apague.');
    try {
      await api.patch(`/api/messages/${msg.id}`, { content });
      ui({ editing: null });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="msg-edit">
      <textarea
        ref={ref}
        className="input"
        value={text}
        maxLength={MAX_LENGTH}
        rows={Math.min(8, text.split('\n').length + 1)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') ui({ editing: null });
          else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <small>
        esc pra <button onClick={() => ui({ editing: null })}>cancelar</button> · enter pra <button onClick={save}>salvar</button>
      </small>
    </div>
  );
}

interface RowProps {
  msg: ClientMessage;
  head: boolean;
  server?: Server;
  meId: string;
  canModerate: boolean;
  canPin: boolean;
  editing: boolean;
  ctx: ContentContext;
}

const MessageRow = memo(function MessageRow({ msg, head, server, meId, canModerate, canPin, editing, ctx }: RowProps) {
  const author = useUser(msg.authorId);
  const replyAuthor = useUser(msg.replyTo?.authorId);
  const previews = useSettings((s) => s.linkPreviews);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const mine = msg.authorId === meId;
  const real = msg.id > 0;
  const profile = (e: MouseEvent<HTMLElement>) => openProfile(e, msg.authorId, server?.id);

  const body = useMemo(() => (msg.content ? renderContent(msg.content, { ...ctx, everyone: msg.everyone }) : null), [msg.content, msg.everyone, ctx]);
  const url = useMemo(() => (previews && !msg.attachments.length ? firstUrl(msg.content) : undefined), [previews, msg.content, msg.attachments.length]);

  if (msg.kind === 'join')
    return (
      <div className="msg system" data-mid={msg.id}>
        <ArrowRight />
        <span>
          <button className="msg-author" onClick={profile}>
            {author.name}
          </button>{' '}
          chegou. Puxa uma cadeira!
        </span>
        <time title={formatFull(msg.createdAt)}>{formatStamp(msg.createdAt)}</time>
      </div>
    );

  const react = (emoji: string) => {
    const reacted = msg.reactions.find((r) => r.emoji === emoji)?.users.includes(meId);
    api[reacted ? 'del' : 'put'](`/api/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`).catch(toastError);
  };
  const togglePin = () => api[msg.pinnedAt ? 'del' : 'put'](`/api/messages/${msg.id}/pin`).catch(toastError);
  const remove = () =>
    openModal({
      type: 'confirm',
      title: 'Apagar mensagem?',
      body: 'Ela some pra todo mundo. Não dá pra desfazer.',
      action: 'Apagar',
      danger: true,
      onConfirm: () => api.del(`/api/messages/${msg.id}`),
    });

  const menu = (e: MouseEvent) => {
    if (!real || window.getSelection()?.toString()) return;
    const items: (MenuItem | false)[] = [
      { label: 'Responder', icon: <Reply />, onSelect: () => setReply(msg, msg.channelId) },
      { label: 'Copiar texto', icon: <Copy />, disabled: !msg.content, onSelect: () => copyText(msg.content) },
      canPin && { label: msg.pinnedAt ? 'Desafixar' : 'Fixar', icon: msg.pinnedAt ? <PinOff /> : <Pin />, onSelect: togglePin },
      mine && { label: 'Editar', icon: <Pencil />, onSelect: () => ui({ editing: msg.id }) },
      (mine || canModerate) && { label: '', separator: true },
      (mine || canModerate) && { label: 'Apagar', icon: <Trash2 />, danger: true, onSelect: remove },
    ];
    openMenu(e, items.filter((i): i is MenuItem => !!i));
  };

  const mentioned = !mine && (msg.everyone || msg.mentions.includes(meId));

  return (
    <div
      className={cx('msg', head && 'head', mentioned && 'mentioned', msg.pending && 'pending', msg.failed && 'failed', editing && 'editing', picker && 'busy')}
      data-mid={msg.id}
      onContextMenu={menu}
    >
      {msg.replyTo && (
        <button className="msg-reply" onClick={() => msg.replyTo && jumpToMessage(msg.replyTo.id)}>
          <CornerUpRight />
          {msg.replyTo.authorId ? (
            <>
              <Avatar user={replyAuthor} size="1.1rem" />
              <b>{replyAuthor.name}</b>
              <span className="truncate">{msg.replyTo.content || 'anexo'}</span>
            </>
          ) : (
            <span className="truncate">mensagem apagada</span>
          )}
        </button>
      )}
      <div className="msg-gutter">
        {head ? (
          <button className="msg-avatar" onClick={profile} aria-label={`Perfil de ${author.name}`}>
            <Avatar user={author} size="2.5rem" />
          </button>
        ) : (
          <time>{formatTime(msg.createdAt)}</time>
        )}
      </div>
      <div className="msg-main">
        {head && (
          <div className="msg-meta">
            <button className="msg-author" style={{ color: roleColor(server, msg.authorId) }} onClick={profile}>
              {author.name}
            </button>
            <time title={formatFull(msg.createdAt)}>{formatStamp(msg.createdAt)}</time>
            {msg.pinnedAt && <Pin className="msg-pin" aria-label="Fixada" />}
          </div>
        )}
        {editing ? (
          <EditBox msg={msg} />
        ) : (
          body && (
            <div className={cx('msg-body', isJumbo(msg.content) && 'jumbo')}>
              {body}
              {msg.editedAt && (
                <span className="edited" title={'Editada ' + formatStamp(msg.editedAt)}>
                  (editada)
                </span>
              )}
            </div>
          )
        )}
        {msg.attachments.length > 0 && (
          <div className="msg-atts">
            {msg.attachments.map((a) => (
              <AttachmentView key={a.url} a={a} />
            ))}
          </div>
        )}
        {url && <LinkCard url={url} />}
        {msg.reactions.length > 0 && (
          <div className="reactions">
            {msg.reactions.map((r) => (
              <button key={r.emoji} className={cx('reaction', r.users.includes(meId) && 'mine')} onClick={() => react(r.emoji)} aria-label={`Reagir com ${r.emoji}`}>
                <span>{r.emoji}</span>
                <b>{r.users.length}</b>
              </button>
            ))}
            <button className="reaction add" aria-label="Outra reação" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
              <SmilePlus />
            </button>
          </div>
        )}
        {msg.failed && (
          <div className="msg-failed">
            Não foi enviada.{' '}
            <button
              onClick={() => {
                discardFailed(msg.channelId, msg.nonce!);
                void sendMessage(msg.channelId, msg.content, msg.attachments);
              }}
            >
              Tentar de novo
            </button>{' '}
            · <button onClick={() => discardFailed(msg.channelId, msg.nonce!)}>Descartar</button>
          </div>
        )}
      </div>

      {real && !editing && (
        <div className="msg-actions">
          {QUICK_REACTIONS.map((emoji) => (
            <button key={emoji} className="icon-btn emoji" aria-label={`Reagir com ${emoji}`} onClick={() => react(emoji)}>
              {emoji}
            </button>
          ))}
          <IconButton label="Reagir" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
            <SmilePlus />
          </IconButton>
          <IconButton label="Responder" onClick={() => setReply(msg, msg.channelId)}>
            <Reply />
          </IconButton>
          {mine && (
            <IconButton label="Editar" onClick={() => ui({ editing: msg.id })}>
              <Pencil />
            </IconButton>
          )}
          <IconButton label="Mais" onClick={menu}>
            <MoreHorizontal />
          </IconButton>
        </div>
      )}
      {picker && (
        <Popover anchor={picker} onClose={() => setPicker(null)}>
          <EmojiPicker
            onPick={(emoji) => {
              setPicker(null);
              if (!msg.reactions.find((r) => r.emoji === emoji)?.users.includes(meId)) react(emoji);
            }}
          />
        </Popover>
      )}
    </div>
  );
});

// ---------- lista ----------

interface ListApi {
  toBottom: () => void;
}

function MessageList({ channel, server, listApi }: { channel: Channel; server?: Server; listApi: RefObject<ListApi | null> }) {
  const me = useMe();
  const log = useApp((s) => s.logs[channel.id]);
  const editing = useUi((s) => s.editing);
  const recipient = useUser(channel.recipientId);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const metrics = useRef({ top: 0, height: 0 });
  const prevFirst = useRef<number | undefined>(undefined);
  const [far, setFar] = useState(false);

  const loaded = !!log?.loaded;
  const hasMore = log?.hasMore ?? true;
  const divider = log?.divider ?? 0;
  const list = log?.list ?? [];
  const firstId = list.find((m) => m.id > 0)?.id;
  const perms = server ? permsOf(server, me.id) : 0;
  const canModerate = (perms & P.MANAGE_MESSAGES) !== 0;

  // Depois de uma reconexão os históricos são descartados: `loaded` volta a falso e isto busca de novo.
  useEffect(() => {
    if (!loaded) void loadMessages(channel.id);
    else if (useApp.getState().unread[channel.id] && document.hasFocus()) markRead(channel.id);
  }, [channel.id, loaded]);

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
  };
  listApi.current = { toBottom };

  // Mensagens antigas entram por cima: a posição é corrigida pra tela não pular.
  // Mensagens novas entram por baixo: a tela acompanha só se já estava no fim.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const prepended = prevFirst.current !== undefined && firstId !== undefined && firstId < prevFirst.current;
    if (prepended && !stick.current) el.scrollTop = metrics.current.top + (el.scrollHeight - metrics.current.height);
    else if (stick.current) el.scrollTop = el.scrollHeight;
    prevFirst.current = firstId;
    metrics.current = { top: el.scrollTop, height: el.scrollHeight };
  }, [list, firstId]);

  // Imagem ou prévia que termina de carregar muda a altura: se a pessoa estava no fim, continua no fim.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const box = scroller.current;
      if (box && stick.current) box.scrollTop = box.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = fromBottom < 80;
    metrics.current = { top: el.scrollTop, height: el.scrollHeight };
    setFar(fromBottom > 500);
    if (el.scrollTop < 400) void loadOlder(channel.id);
  };

  // Quem são os @mencionáveis deste canal. Lê o estado na hora, pra não refazer a lista a cada presença.
  const ctx = useMemo<ContentContext>(
    () => ({
      everyone: false,
      onMention: (e, userId) => openProfile(e, userId, server?.id),
      byHandle: (handle) => {
        const s = useApp.getState();
        const ids = channel.serverId ? (s.servers[channel.serverId]?.members.map((m) => m.userId) ?? []) : [channel.recipientId ?? '', me.id];
        for (const id of ids) if (s.users[id]?.handle.toLowerCase() === handle) return s.users[id];
        return undefined;
      },
    }),
    [channel.serverId, channel.recipientId, me.id, server?.id],
  );

  let dividerShown = false;

  return (
    <div className="messages" ref={scroller} onScroll={onScroll}>
      <div className="messages-inner" ref={content}>
        {!loaded && (
          <div className="messages-loading">
            <span className="spinner" />
          </div>
        )}
        {loaded && !hasMore && (
          <div className="chat-start">
            {channel.kind === 'dm' ? (
              <>
                <Avatar user={recipient} size="4.5rem" />
                <h2>{recipient.name}</h2>
                <p>Aqui começa a conversa de vocês dois. Só vocês veem o que rola aqui.</p>
              </>
            ) : (
              <>
                <span className="chat-start-icon">{channel.kind === 'voice' ? <Volume2 /> : <Hash />}</span>
                <h2>{channel.kind === 'voice' ? channel.name : `Este é o começo de #${channel.name}`}</h2>
                <p>{channel.topic || (channel.kind === 'voice' ? 'O papo por escrito desta sala de voz fica aqui.' : 'Ninguém falou por aqui ainda? Puxa o assunto.')}</p>
              </>
            )}
          </div>
        )}
        {loaded && log?.loading && hasMore && (
          <div className="messages-loading">
            <span className="spinner" />
          </div>
        )}
        {list.map((msg, i) => {
          const prev = list[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, msg.createdAt);
          const head = newDay || !!msg.replyTo || !!prev.kind || prev.authorId !== msg.authorId || msg.createdAt - prev.createdAt > 5 * 60_000;
          // A linha de "novas" aparece uma vez, antes da primeira mensagem de outra pessoa depois do que já foi lido.
          const isNew = !dividerShown && divider > 0 && msg.id > divider && msg.authorId !== me.id && !msg.kind && !!prev;
          if (isNew) dividerShown = true;
          return (
            // A chave é o nonce quando existe: a mensagem pendente e a confirmada são a mesma linha.
            <div key={msg.nonce ?? msg.id}>
              {newDay && (
                <div className="day-divider">
                  <span>{formatDay(msg.createdAt)}</span>
                </div>
              )}
              {isNew && (
                <div className="new-divider">
                  <span>novas</span>
                </div>
              )}
              <MessageRow
                msg={msg}
                head={head || isNew}
                server={server}
                meId={me.id}
                canModerate={canModerate}
                canPin={!server || canModerate}
                editing={editing === msg.id}
                ctx={ctx}
              />
            </div>
          );
        })}
      </div>
      {far && (
        <button className="jump-bottom" onClick={toBottom}>
          <ArrowDown /> Ir pro fim
        </button>
      )}
    </div>
  );
}

function TypingBar({ channelId }: { channelId: string }) {
  const meId = useMe().id;
  const typing = useApp((s) => s.typing[channelId]);
  const users = useApp((s) => s.users);
  const names = Object.keys(typing ?? {})
    .filter((id) => id !== meId)
    .map((id) => users[id]?.name ?? 'Alguém');
  return (
    <div className="typing" aria-live="polite">
      {names.length > 0 && (
        <>
          <span className="typing-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="truncate">
            {names.length === 1 ? (
              <>
                <b>{names[0]}</b> está digitando…
              </>
            ) : names.length === 2 ? (
              <>
                <b>{names[0]}</b> e <b>{names[1]}</b> estão digitando…
              </>
            ) : (
              'Várias pessoas estão digitando…'
            )}
          </span>
        </>
      )}
    </div>
  );
}

// ---------- campo de escrever ----------

interface Upload {
  id: string;
  name: string;
  size: number;
  progress: number;
  preview?: string;
  attachment?: Attachment;
}

interface ComposerApi {
  addFiles: (files: File[]) => void;
}

function Composer({ channel, server, placeholder, onSent, composerApi }: { channel: Channel; server?: Server; placeholder: string; onSent: () => void; composerApi: RefObject<ComposerApi | null> }) {
  const me = useMe();
  const reply = useUi((s) => s.reply[channel.id]);
  const replyAuthor = useUser(reply?.authorId);
  const [text, setText] = useState(() => useUi.getState().drafts[channel.id] ?? '');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;

  // O rascunho de cada canal fica guardado enquanto a pessoa passeia por outros.
  useEffect(() => () => ui((s) => ({ drafts: { ...s.drafts, [channel.id]: textRef.current } })), [channel.id]);

  useEffect(() => {
    if (matchMedia('(hover: hover)').matches) input.current?.focus();
  }, [channel.id, reply]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, innerHeight * 0.4) + 'px';
  }, [text]);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const s = useApp.getState();
    const ids = server ? server.members.map((m) => m.userId) : [channel.recipientId ?? ''];
    const q = mention.query.toLowerCase();
    const found: { handle: string; user?: User }[] = ids
      .map((id) => s.users[id])
      .filter((u): u is User => !!u && u.id !== me.id && (u.handle.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.handle.startsWith(q)) - Number(a.handle.startsWith(q)) || a.name.localeCompare(b.name))
      .slice(0, 7)
      .map((user) => ({ handle: user.handle, user }));
    if (server && permsOf(server, me.id) & P.MENTION_ALL && 'todos'.startsWith(q)) found.push({ handle: 'todos' });
    return found;
  }, [mention, server, channel.recipientId, me.id]);

  const onChange = (value: string, caret: number) => {
    setText(value);
    const found = /(?:^|\s)@([a-z0-9_.]{0,20})$/i.exec(value.slice(0, caret));
    setMention(found ? { query: found[1], start: caret - found[1].length - 1, index: 0 } : null);
    if (value.trim() && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      gateway.send('typing', { channelId: channel.id });
    }
  };

  const insert = (piece: string, from?: number, to?: number) => {
    const el = input.current;
    if (!el) return;
    const start = from ?? el.selectionStart;
    const end = to ?? el.selectionEnd;
    const next = text.slice(0, start) + piece + text.slice(end);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + piece.length, start + piece.length);
    });
  };

  const pickMention = (handle: string) => mention && insert(`@${handle} `, mention.start, input.current?.selectionStart);

  const addFiles = (files: File[]) => {
    const room = 10 - uploads.length;
    if (files.length > room) toast('Dá pra mandar até 10 arquivos por mensagem.');
    for (const file of files.slice(0, Math.max(0, room))) {
      if (file.size > MAX_FILE) {
        toast(`${file.name} passa de 25 MB.`, 'error');
        continue;
      }
      const id = Math.random().toString(36).slice(2);
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      setUploads((u) => [...u, { id, name: file.name || 'imagem.png', size: file.size, progress: 0, preview }]);
      const patch = (change: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...change } : x)));
      void (async () => {
        try {
          const size = await imageSize(file);
          const attachment = await api.upload(file, file.name || 'imagem.png', (progress) => patch({ progress }));
          patch({ attachment: { ...attachment, ...size }, progress: 1 });
        } catch (e) {
          toastError(e);
          setUploads((u) => u.filter((x) => x.id !== id));
        }
      })();
    }
    input.current?.focus();
  };
  composerApi.current = { addFiles };

  const uploading = uploads.some((u) => !u.attachment);
  const canSend = (text.trim().length > 0 || uploads.length > 0) && !uploading && text.length <= MAX_LENGTH;

  const send = () => {
    if (!canSend) return;
    void sendMessage(
      channel.id,
      text.trim(),
      uploads.map((u) => u.attachment!),
      reply,
    );
    for (const u of uploads) if (u.preview) URL.revokeObjectURL(u.preview);
    setText('');
    setUploads([]);
    setMention(null);
    setReply(undefined, channel.id);
    lastTyping.current = 0;
    onSent();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        return setMention({ ...mention, index: (mention.index + step + candidates.length) % candidates.length });
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        return pickMention(candidates[mention.index]?.handle ?? candidates[0].handle);
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        return setMention(null);
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && reply) setReply(undefined, channel.id);
    else if (e.key === 'ArrowUp' && !text) {
      // Seta pra cima no campo vazio: edita a sua última mensagem.
      const last = useApp.getState().logs[channel.id]?.list.findLast((m) => m.authorId === me.id && m.id > 0 && !m.kind);
      if (last) {
        e.preventDefault();
        ui({ editing: last.id });
      }
    }
  };

  return (
    <div className="composer-wrap">
      {mention && candidates.length > 0 && (
        <div className="mention-list" role="listbox">
          {candidates.map((c, i) => (
            <button
              key={c.handle}
              role="option"
              aria-selected={i === mention.index}
              className={cx(i === mention.index && 'on')}
              onMouseDown={(e) => (e.preventDefault(), pickMention(c.handle))}
              onMouseEnter={() => setMention({ ...mention, index: i })}
            >
              {c.user ? <Avatar user={c.user} size="1.5rem" /> : <AtSign />}
              <b>{c.user?.name ?? 'todos'}</b>
              <small>{c.user ? '@' + c.handle : 'avisa todo mundo do servidor'}</small>
            </button>
          ))}
        </div>
      )}
      <div className="composer">
        {reply && (
          <div className="composer-reply">
            <Reply />
            <span className="truncate">
              Respondendo a <b>{replyAuthor.name}</b>
            </span>
            <IconButton label="Cancelar resposta" onClick={() => setReply(undefined, channel.id)}>
              <X />
            </IconButton>
          </div>
        )}
        {uploads.length > 0 && (
          <div className="composer-uploads">
            {uploads.map((u) => (
              <div key={u.id} className={cx('upload', !u.attachment && 'busy')}>
                {u.preview ? <img src={u.preview} alt="" /> : <FileText />}
                <span className="truncate">{u.name}</span>
                {!u.attachment && <span className="upload-bar" style={{ width: `${u.progress * 100}%` }} />}
                <button
                  aria-label={`Remover ${u.name}`}
                  onClick={() => {
                    if (u.preview) URL.revokeObjectURL(u.preview);
                    setUploads((list) => list.filter((x) => x.id !== u.id));
                  }}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <label className="icon-btn" data-tip="Anexar arquivo" aria-label="Anexar arquivo">
            <Plus />
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </label>
          <textarea
            ref={input}
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onBlur={() => setTimeout(() => setMention(null), 120)}
          />
          {text.length > MAX_LENGTH - 300 && <span className={cx('composer-count', text.length > MAX_LENGTH && 'over')}>{MAX_LENGTH - text.length}</span>}
          <IconButton label="Emoji" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
            <Smile />
          </IconButton>
          <IconButton label="Enviar" className={cx('send', canSend && 'ready')} disabled={!canSend} onClick={send}>
            <SendHorizontal />
          </IconButton>
        </div>
      </div>
      {picker && (
        <Popover anchor={picker} onClose={() => setPicker(null)}>
          <EmojiPicker onPick={(emoji) => insert(emoji)} />
        </Popover>
      )}
    </div>
  );
}

// ---------- fixadas e busca ----------

function ResultCard({ msg, onUnpin }: { msg: Message; onUnpin?: () => void }) {
  const author = useUser(msg.authorId);
  return (
    <div className="result">
      <div className="row">
        <Avatar user={author} size="1.6rem" />
        <b className="truncate">{author.name}</b>
        <time className="muted">{formatStamp(msg.createdAt)}</time>
      </div>
      <p>{msg.content || (msg.attachments.length ? '📎 ' + msg.attachments.map((a) => a.name).join(', ') : '')}</p>
      <div className="row">
        <button className="btn small ghost" onClick={() => jumpToMessage(msg.id)}>
          Ver na conversa
        </button>
        {onUnpin && (
          <button className="btn small ghost" onClick={onUnpin}>
            Desafixar
          </button>
        )}
      </div>
    </div>
  );
}

function PinsPanel({ channel, canPin }: { channel: Channel; canPin: boolean }) {
  // Recarrega quando qualquer mensagem do canal muda de estado de fixada.
  const pinned = useApp((s) => s.logs[channel.id]?.list.filter((m) => m.pinnedAt).length ?? 0);
  const { data, error } = useFetch<Message[]>(`/api/channels/${channel.id}/pins`, `${channel.id}:${pinned}`);
  return (
    <aside className="chat-panel">
      <header>
        <Pin /> <b className="grow">Fixadas</b>
        <IconButton label="Fechar" tip="left" onClick={() => ui({ panel: null })}>
          <X />
        </IconButton>
      </header>
      <div className="chat-panel-body">
        {error && <p className="error-text">{error}</p>}
        {data?.length === 0 && <p className="muted">Nada fixado ainda. Fixe uma mensagem importante pelo menu dela — ela fica guardada aqui.</p>}
        {data?.map((m) => <ResultCard key={m.id} msg={m} onUnpin={canPin ? () => api.del(`/api/messages/${m.id}/pin`).catch(toastError) : undefined} />)}
      </div>
    </aside>
  );
}

function SearchPanel({ channel }: { channel: Channel }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const { data, error } = useFetch<Message[]>(query.length >= 2 ? `/api/channels/${channel.id}/search?q=${encodeURIComponent(query)}` : null, query);
  return (
    <aside className="chat-panel">
      <header>
        <Search />
        <input className="grow" autoFocus placeholder="Buscar neste canal" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && ui({ panel: null })} />
        <IconButton label="Fechar" tip="left" onClick={() => ui({ panel: null })}>
          <X />
        </IconButton>
      </header>
      <div className="chat-panel-body">
        {error && <p className="error-text">{error}</p>}
        {query.length < 2 ? (
          <p className="muted">Digite pelo menos duas letras.</p>
        ) : (
          data && (data.length === 0 ? <p className="muted">Nada encontrado com “{query}”.</p> : data.map((m) => <ResultCard key={m.id} msg={m} />))
        )}
      </div>
    </aside>
  );
}

// ---------- a conversa inteira ----------

/** Só o miolo (lista + campo): é o que a sala de voz embute como chat lateral. */
export function ChatBody({ channel, server }: { channel: Channel; server?: Server }) {
  const recipient = useUser(channel.recipientId);
  const listApi = useRef<ListApi | null>(null);
  const composerApi = useRef<ComposerApi | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const placeholder = channel.kind === 'dm' ? `Mensagem para ${recipient.name}` : channel.kind === 'voice' ? `Mensagem em ${channel.name}` : `Mensagem em #${channel.name}`;

  return (
    <div
      className="chat-body"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        depth.current++;
        setDragging(true);
      }}
      onDragLeave={() => --depth.current <= 0 && ((depth.current = 0), setDragging(false))}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        composerApi.current?.addFiles([...e.dataTransfer.files]);
      }}
    >
      <MessageList key={channel.id} channel={channel} server={server} listApi={listApi} />
      <TypingBar channelId={channel.id} />
      <Composer key={'c' + channel.id} channel={channel} server={server} placeholder={placeholder} onSent={() => listApi.current?.toBottom()} composerApi={composerApi} />
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Plus />
            <b>Solte pra anexar</b>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatHeader({ channel, server }: { channel: Channel; server?: Server }) {
  const recipient = useUser(channel.recipientId);
  const panel = useUi((s) => s.panel);
  const membersOpen = useSettings((s) => s.membersOpen);
  const inCall = useApp((s) => !!s.voice[channel.id]);
  const dm = channel.kind === 'dm';
  return (
    <header className="main-head">
      <IconButton label="Abrir servidores e canais" className="only-mobile" tip="bottom" onClick={() => ui({ drawer: true })}>
        <Menu />
      </IconButton>
      {dm ? (
        <button className="row head-title" onClick={(e) => openProfile(e, recipient.id)}>
          <Avatar user={recipient} size="1.7rem" status={recipient.status} ring="var(--bg-2)" />
          <b className="truncate">{recipient.name}</b>
        </button>
      ) : (
        <div className="row head-title">
          <Hash className="head-icon" />
          <b className="truncate">{channel.name}</b>
        </div>
      )}
      {!dm && channel.topic && <span className="head-topic truncate">{channel.topic}</span>}
      <span className="grow" />
      {dm && (
        <IconButton label={inCall ? 'Entrar na chamada' : 'Ligar'} tip="bottom" on={inCall} onClick={() => joinVoice(channel.id)}>
          <Phone />
        </IconButton>
      )}
      <IconButton label="Fixadas" tip="bottom" on={panel === 'pins'} onClick={() => ui({ panel: panel === 'pins' ? null : 'pins' })}>
        <Pin />
      </IconButton>
      <IconButton label="Buscar no canal" tip="bottom" on={panel === 'search'} onClick={() => ui({ panel: panel === 'search' ? null : 'search' })}>
        <Search />
      </IconButton>
      {server && (
        <IconButton label={membersOpen ? 'Esconder membros' : 'Mostrar membros'} tip="left" on={membersOpen} onClick={() => setSettings({ membersOpen: !membersOpen })}>
          <Users />
        </IconButton>
      )}
    </header>
  );
}

export function ChatPanels({ channel, server }: { channel: Channel; server?: Server }) {
  const me = useMe();
  const panel = useUi((s) => s.panel);
  const canPin = !server || (permsOf(server, me.id) & P.MANAGE_MESSAGES) !== 0;
  if (panel === 'pins') return <PinsPanel channel={channel} canPin={canPin} />;
  if (panel === 'search') return <SearchPanel channel={channel} />;
  return null;
}

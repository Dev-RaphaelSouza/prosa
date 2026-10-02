// Formatação das mensagens: um markdown pequeno, montado direto em elementos React (nunca em HTML cru).
import { useState, type MouseEvent, type ReactNode } from 'react';
import type { User } from '../../shared/types';

export interface ContentContext {
  /** Acha a pessoa pelo @usuario, entre quem enxerga o canal. */
  byHandle: (handle: string) => User | undefined;
  everyone: boolean;
  onMention: (e: MouseEvent<HTMLElement>, userId: string) => void;
}

// Ordem importa: código primeiro (dentro dele nada é formatado), depois os pares, link e menção.
const TOKEN =
  /(`[^`\n]+`)|(\|\|[\s\S]+?\|\|)|(\*\*[\s\S]+?\*\*)|(~~[\s\S]+?~~)|(__[\s\S]+?__)|(\*[^\s*](?:[^*\n]*[^\s*])?\*)|((?<!\w)_[^_\n]+_(?!\w))|(https?:\/\/[^\s<>]+)|((?<![\w@])@[a-z0-9_.]{3,20})/gi;

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={'spoiler' + (open ? ' open' : '')} onClick={() => setOpen(true)} role="button" aria-label={open ? undefined : 'Mostrar spoiler'}>
      {children}
    </span>
  );
}

function inline(text: string, ctx: ContentContext, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    last = at + raw.length;
    const k = `${key}.${n++}`;
    const inner = (cut: number) => inline(raw.slice(cut, -cut), ctx, k);

    if (m[1]) out.push(<code key={k}>{raw.slice(1, -1)}</code>);
    else if (m[2]) out.push(<Spoiler key={k}>{inner(2)}</Spoiler>);
    else if (m[3]) out.push(<strong key={k}>{inner(2)}</strong>);
    else if (m[4]) out.push(<s key={k}>{inner(2)}</s>);
    else if (m[5]) out.push(<u key={k}>{inner(2)}</u>);
    else if (m[6] || m[7]) out.push(<em key={k}>{inner(1)}</em>);
    else if (m[8]) {
      // Pontuação colada no fim do link ("veja https://x.com.") fica fora dele.
      const url = raw.replace(/[.,!?;:)\]'"]+$/, '');
      out.push(
        <a key={k} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>,
      );
      if (url.length < raw.length) out.push(raw.slice(url.length));
    } else {
      const handle = raw.slice(1).toLowerCase();
      const user = ctx.byHandle(handle);
      if (user)
        out.push(
          <span key={k} className="mention" onClick={(e) => ctx.onMention(e, user.id)}>
            @{user.name}
          </span>,
        );
      else if (handle === 'todos' && ctx.everyone)
        out.push(
          <span key={k} className="mention">
            @todos
          </span>,
        );
      else out.push(raw);
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderContent(text: string, ctx: ContentContext): ReactNode[] {
  const out: ReactNode[] = [];
  // Índices ímpares do split são o miolo dos blocos ```código```.
  text.split(/```(?:[a-z0-9+#-]*\n)?([\s\S]*?)```/gi).forEach((part, i) => {
    if (i % 2) {
      out.push(
        <pre key={i}>
          <code>{part.replace(/\n$/, '')}</code>
        </pre>,
      );
      return;
    }
    if (!part) return;
    // Linhas seguidas começando com "> " viram uma citação só.
    let quote: string[] = [];
    let plain: string[] = [];
    const flush = (j: number) => {
      if (quote.length) out.push(<blockquote key={`${i}q${j}`}>{inline(quote.join('\n'), ctx, `${i}q${j}`)}</blockquote>);
      if (plain.length) out.push(...inline(plain.join('\n'), ctx, `${i}p${j}`));
      quote = [];
      plain = [];
    };
    part.split('\n').forEach((line, j) => {
      const quoted = line.startsWith('> ');
      if (quoted ? plain.length : quote.length) flush(j);
      if (quoted) quote.push(line.slice(2));
      else plain.push(line);
    });
    flush(-1);
  });
  return out;
}

export const firstUrl = (text: string) => /https?:\/\/[^\s<>]+/i.exec(text.replace(/```[\s\S]*?```|`[^`\n]+`/g, ''))?.[0].replace(/[.,!?;:)\]'"]+$/, '');

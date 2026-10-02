import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LinkPreview } from '../../shared/types';

/** O instante atual, renovado a cada segundo enquanto `active` (cronômetros). */
export function useNow(active = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Busca alguma coisa ao montar (e quando `key` muda). Devolve também como recarregar. */
export function useFetch<T>(path: string | null, key: unknown = path) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setError('');
    api
      .get<T>(path)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}

// Prévia de link: uma busca por endereço, compartilhada por todas as mensagens que o citam.
const previews = new Map<string, Promise<LinkPreview | null>>();

export function usePreview(url: string | undefined): LinkPreview | null {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!url) return;
    let alive = true;
    let pending = previews.get(url);
    if (!pending) {
      pending = api
        .get<{ preview: LinkPreview | null }>('/api/preview?url=' + encodeURIComponent(url))
        .then((r) => r.preview)
        .catch(() => null);
      previews.set(url, pending);
    }
    void pending.then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [url]);
  return preview;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setMatch(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return match;
}

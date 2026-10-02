import type { Attachment } from '../shared/types';

const TOKEN_KEY = 'prosa.token';

export const session = {
  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* navegação privada: a sessão só não sobrevive ao recarregar */
    }
  },
  /** Chamado quando o servidor responde 401: a sessão acabou. */
  onExpired: () => {},
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(session.token ? { Authorization: 'Bearer ' + session.token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem resposta do servidor. Confira a conexão.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && session.token && !path.startsWith('/api/auth/')) session.onExpired();
    throw new ApiError(res.status, data?.error ?? `Erro ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),

  /** Envia o arquivo cru, com progresso (por isso XHR e não fetch). */
  upload(file: Blob, name: string, onProgress?: (fraction: number) => void): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload?name=' + encodeURIComponent(name));
      xhr.setRequestHeader('Authorization', 'Bearer ' + session.token);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onerror = () => reject(new ApiError(0, 'O envio falhou. Confira a conexão.'));
      xhr.onload = () => {
        if (xhr.status === 200) resolve(xhr.response as Attachment);
        else reject(new ApiError(xhr.status, xhr.response?.error ?? `Erro ${xhr.status}`));
      };
      xhr.send(file);
    });
  },
};

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado.');

// Entrada: entrar, criar conta, recuperar a senha — e a tela de convite, com ou sem conta.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Users } from 'lucide-react';
import { api } from '../api';
import { useFetch } from '../lib/hooks';
import { goServer, navigate, signIn, signOut, useApp } from '../store';
import { Avatar, Button, Logo, ServerIcon, useAction } from './ui';
import type { InvitePreview } from '../../shared/types';

type Mode = 'login' | 'register' | 'forgot';

function InviteCard({ invite }: { invite: InvitePreview }) {
  return (
    <div className="invite-card">
      <span className="invite-icon">
        <ServerIcon server={invite.server} />
      </span>
      <div className="grow">
        <small>{invite.inviter ? `${invite.inviter.name} te chamou pra` : 'Você foi chamado pra'}</small>
        <b>{invite.server.name}</b>
        <small className="row">
          <Users size={14} /> {invite.server.members} {invite.server.members === 1 ? 'membro' : 'membros'} · {invite.server.online} por aqui agora
        </small>
      </div>
    </div>
  );
}

function Frame({ children, invite }: { children: ReactNode; invite?: InvitePreview | null }) {
  return (
    <div className="auth">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={40} />
          <div>
            <h1>Prosa</h1>
            <p>Puxa uma cadeira.</p>
          </div>
        </div>
        {invite && <InviteCard invite={invite} />}
        {children}
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, label, autoComplete }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="password">
        <input className="input" type={shown ? 'text' : 'password'} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? 'Esconder a senha' : 'Mostrar a senha'}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </label>
  );
}

export function Auth() {
  const route = useApp((s) => s.route);
  const code = route.page === 'invite' ? route.code : null;
  const { data: invite, error: inviteError } = useFetch<InvitePreview>(code ? `/api/invites/${code}` : null);
  const [mode, setMode] = useState<Mode>(code ? 'register' : 'login');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run, setError } = useAction();

  if (route.page === 'reset') return <Reset token={route.token} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === 'forgot') {
        await api.post('/api/auth/forgot', { handle });
        return setSent(true);
      }
      const body = mode === 'register' ? { handle, name: name || handle, password } : { handle, password };
      const { token } = await api.post<{ token: string }>(`/api/auth/${mode}`, body);
      // Com convite na URL, a rota continua sendo o convite: depois de entrar, cai na tela de aceitar.
      await signIn(token);
    });
  };
  const go = (next: Mode) => {
    setError('');
    setSent(false);
    setMode(next);
  };

  return (
    <Frame invite={invite}>
      {code && inviteError && <p className="error-text">{inviteError}</p>}
      <form onSubmit={submit} className="auth-form">
        <h2>{mode === 'login' ? (code ? 'Entre pra aceitar o convite' : 'Que bom te ver de novo') : mode === 'register' ? 'Criar uma conta' : 'Recuperar a senha'}</h2>

        {mode === 'forgot' && sent ? (
          <p className="auth-note">
            Pedido registrado. Se a conta existir, quem cuida deste servidor do Prosa recebe um link de redefinição (ele aparece no console do servidor) e pode te passar. O link vale por 1 hora.
          </p>
        ) : (
          <>
            <label className="field">
              <span>{mode === 'register' ? 'Usuário' : 'Usuário ou e-mail'}</span>
              <input
                className="input"
                autoFocus
                value={handle}
                onChange={(e) => setHandle(mode === 'register' ? e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') : e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={mode === 'register' ? 20 : 120}
              />
              {mode === 'register' && <small>É o seu @: letras minúsculas, números, ponto e sublinhado. De 3 a 20.</small>}
            </label>
            {mode === 'register' && (
              <label className="field">
                <span>Como te chamam</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder={handle || 'Seu nome'} autoComplete="nickname" />
              </label>
            )}
            {mode !== 'forgot' && <PasswordField label={mode === 'register' ? 'Senha (mínimo de 6 caracteres)' : 'Senha'} value={password} onChange={setPassword} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />}
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        {!(mode === 'forgot' && sent) && (
          <Button variant="primary" block type="submit" loading={busy} disabled={handle.length < 3 || (mode !== 'forgot' && password.length < (mode === 'register' ? 6 : 1))}>
            {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Pedir link de redefinição'}
          </Button>
        )}

        <div className="auth-links">
          {mode === 'login' ? (
            <>
              <button type="button" onClick={() => go('register')}>
                Criar uma conta
              </button>
              <button type="button" onClick={() => go('forgot')}>
                Esqueci a senha
              </button>
            </>
          ) : (
            <button type="button" onClick={() => go('login')}>
              Já tenho conta
            </button>
          )}
        </div>
      </form>
    </Frame>
  );
}

function Reset({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Frame>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const res = await api.post<{ token: string }>('/api/auth/reset', { token, password });
            navigate('/', true);
            await signIn(res.token);
          });
        }}
      >
        <h2>Escolha uma senha nova</h2>
        <PasswordField label="Senha nova (mínimo de 6 caracteres)" value={password} onChange={setPassword} autoComplete="new-password" />
        {error && <p className="error-text">{error}</p>}
        <Button variant="primary" block type="submit" loading={busy} disabled={password.length < 6}>
          Trocar a senha e entrar
        </Button>
        <div className="auth-links">
          <button type="button" onClick={() => navigate('/', true)}>
            Voltar pra entrada
          </button>
        </div>
      </form>
    </Frame>
  );
}

/** Convite aberto por quem já está logado. */
export function InviteScreen({ code }: { code: string }) {
  const me = useApp((s) => s.me)!;
  const { data: invite, error } = useFetch<InvitePreview>(`/api/invites/${code}`);
  const accept = useAction();
  const enter = (serverId: string) => {
    // O servidor chega pelo gateway logo depois de aceitar; espera por ele antes de navegar.
    const tryGo = (tries: number) => (useApp.getState().servers[serverId] || tries <= 0 ? goServer(serverId, true) : setTimeout(() => tryGo(tries - 1), 120));
    tryGo(20);
  };
  return (
    <Frame invite={invite}>
      <div className="auth-form">
        {error ? (
          <>
            <h2>Esse convite não vale</h2>
            <p className="auth-note">{error} Peça um link novo pra quem te chamou.</p>
          </>
        ) : invite?.member ? (
          <h2>Você já está neste servidor</h2>
        ) : (
          <h2>Aceitar o convite?</h2>
        )}
        <div className="row auth-me">
          <Avatar user={me} size="2rem" />
          <span className="grow truncate">
            Entrando como <b>{me.name}</b>
          </span>
          <button type="button" className="link" onClick={() => signOut()}>
            trocar de conta
          </button>
        </div>
        {accept.error && <p className="error-text">{accept.error}</p>}
        {invite && (
          <Button
            variant="primary"
            block
            loading={accept.busy}
            onClick={() => (invite.member ? enter(invite.server.id) : accept.run(async () => enter((await api.post<{ serverId: string }>(`/api/invites/${code}/accept`)).serverId)))}
          >
            {invite.member ? 'Abrir o servidor' : 'Entrar no servidor'}
          </Button>
        )}
        <div className="auth-links">
          <button type="button" onClick={() => navigate('/', true)}>
            Agora não
          </button>
        </div>
      </div>
    </Frame>
  );
}

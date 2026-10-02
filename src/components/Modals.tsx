// Modais curtos: criar servidor (com modelos), entrar por convite, criar canal, convidar.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Briefcase, Camera, Check, Copy, FileJson, Hash, Link2, Presentation, Shapes, Sofa, Target, Users, Volume2 } from 'lucide-react';
import { api } from '../api';
import { copyText, inviteLink } from '../actions';
import { closeModal, goChannel, goServer, toastError, useApp, useMe, type Modal as ModalState } from '../store';
import { Avatar, Button, ColorPicker, ImageUpload, Modal, Segmented, ServerIcon, cx, useAction } from './ui';
import { P, permsOf } from '../../shared/perms';
import type { Channel, Invite, Server } from '../../shared/types';

const TEMPLATES: { id: string; name: string; desc: string; icon: ReactNode }[] = [
  { id: 'comunidade', name: 'Comunidade', desc: 'Canais de texto e de voz, cargos e convites. O clássico.', icon: <Users /> },
  { id: 'sofa', name: 'Sofá', desc: 'Uma sala de voz com o navegador no centro: todo mundo vê e dirige junto.', icon: <Sofa /> },
  { id: 'trabalho', name: 'Área de trabalho', desc: 'Texto pra combinar, voz pra resolver, foco pra entregar.', icon: <Briefcase /> },
  { id: 'reuniao', name: 'Reunião', desc: 'Uma sala, uma pauta e um link pra mandar.', icon: <Presentation /> },
  { id: 'foco', name: 'Foco', desc: 'Sessão de foco sempre à mão, com a voz aberta.', icon: <Target /> },
  { id: 'vazio', name: 'Do zero', desc: 'Nada pronto. Você monta peça por peça.', icon: <Shapes /> },
];

function addServer(server: Server) {
  useApp.setState((s) => ({ servers: { ...s.servers, [server.id]: server }, serverOrder: s.serverOrder.includes(server.id) ? s.serverOrder : [...s.serverOrder, server.id] }));
  closeModal();
  goServer(server.id);
}

/** Aceita o link inteiro ou só o código. */
const inviteCode = (value: string) => value.trim().split('/').filter(Boolean).pop()?.toLowerCase() ?? '';

export function CreateServerModal() {
  const me = useMe();
  const [step, setStep] = useState<'pick' | 'details' | 'join' | 'manifest'>('pick');
  const [template, setTemplate] = useState('comunidade');
  const [name, setName] = useState(`Servidor de ${me.name}`);
  const [icon, setIcon] = useState<string | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [manifest, setManifest] = useState('');
  const { busy, error, run, setError } = useAction();

  const back = (
    <Button variant="ghost" onClick={() => (setError(''), setStep('pick'))}>
      <ArrowLeft /> Voltar
    </Button>
  );

  if (step === 'pick')
    return (
      <Modal title="Como vai ser o seu servidor?" onClose={closeModal} size="wide">
        <div className="modal-body">
          <div className="templates">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="template"
                onClick={() => {
                  setTemplate(t.id);
                  setStep('details');
                }}
              >
                <span className="template-icon">{t.icon}</span>
                <b>{t.name}</b>
                <small>{t.desc}</small>
              </button>
            ))}
          </div>
        </div>
        <footer className="modal-foot split">
          <Button variant="ghost" onClick={() => setStep('manifest')}>
            <FileJson /> Recriar de um manifesto
          </Button>
          <Button onClick={() => setStep('join')}>
            <Link2 /> Tenho um convite
          </Button>
        </footer>
      </Modal>
    );

  if (step === 'join')
    return (
      <Modal title="Entrar num servidor" onClose={closeModal} size="small">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const { serverId } = await api.post<{ serverId: string }>(`/api/invites/${encodeURIComponent(inviteCode(code))}/accept`);
              closeModal();
              // O servidor chega pelo gateway logo em seguida; se ainda não chegou, a rota se ajusta sozinha.
              setTimeout(() => goServer(serverId), 150);
            });
          }}
        >
          <div className="modal-body">
            <label className="field">
              <span>Link ou código do convite</span>
              <input className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder={inviteLink('abcd2345')} />
            </label>
            {error && <p className="error-text">{error}</p>}
          </div>
          <footer className="modal-foot split">
            {back}
            <Button variant="primary" type="submit" loading={busy} disabled={inviteCode(code).length < 4}>
              Entrar
            </Button>
          </footer>
        </form>
      </Modal>
    );

  if (step === 'manifest')
    return (
      <Modal title="Recriar de um manifesto" onClose={closeModal}>
        <div className="modal-body">
          <p className="muted-2">O manifesto é a estrutura de um servidor em JSON — canais, cargos e tema. Você exporta em Ajustes do servidor → Manifesto e cola aqui pra montar outro igual.</p>
          <textarea className="input mono" autoFocus rows={10} value={manifest} onChange={(e) => setManifest(e.target.value)} placeholder='{ "prosa": 1, "nome": "…", "canais": [], "cargos": [] }' spellCheck={false} />
          {error && <p className="error-text">{error}</p>}
        </div>
        <footer className="modal-foot split">
          {back}
          <Button
            variant="primary"
            loading={busy}
            disabled={!manifest.trim()}
            onClick={() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(manifest);
              } catch {
                return setError('Isso não é um JSON válido. Confira se copiou inteiro.');
              }
              void run(async () => addServer((await api.post<{ server: Server }>('/api/servers', { manifest: parsed })).server));
            }}
          >
            Criar servidor
          </Button>
        </footer>
      </Modal>
    );

  const chosen = TEMPLATES.find((t) => t.id === template)!;
  return (
    <Modal title={`Novo servidor · ${chosen.name}`} onClose={closeModal}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => addServer((await api.post<{ server: Server }>('/api/servers', { name, template, icon, theme: accent ? { accent } : {} })).server));
        }}
      >
        <div className="modal-body">
          <div className="row server-create">
            <ImageUpload onUploaded={setIcon} onError={setError}>
              <span className="server-create-icon" style={accent ? { background: accent } : undefined}>
                {icon ? <img src={icon} alt="" /> : <Camera />}
              </span>
            </ImageUpload>
            <label className="field grow">
              <span>Nome do servidor</span>
              <input className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <div className="field">
            <span>Cor do servidor</span>
            <ColorPicker value={accent} onChange={setAccent} allowNone />
            <small>Quem entra vê o servidor nessa cor (cada pessoa pode preferir a própria nos ajustes).</small>
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>
        <footer className="modal-foot split">
          {back}
          <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>
            Criar servidor
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export function CreateChannelModal({ modal }: { modal: Extract<ModalState, { type: 'createChannel' }> }) {
  const server = useApp((s) => s.servers[modal.serverId]);
  const [kind, setKind] = useState<'text' | 'voice'>(modal.kind ?? 'text');
  const [name, setName] = useState('');
  const [category, setCategory] = useState(modal.category ?? '');
  const [topic, setTopic] = useState('');
  const { busy, error, run } = useAction();
  if (!server) return null;
  const categories = [...new Set(server.channels.map((c) => c.category).filter(Boolean))];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { channel } = await api.post<{ channel: Channel }>(`/api/servers/${server.id}/channels`, { kind, name, category, topic });
      closeModal();
      setTimeout(() => goChannel(server.id, channel.id), 150);
    });
  };

  return (
    <Modal title="Criar canal" onClose={closeModal} size="small">
      <form onSubmit={submit}>
        <div className="modal-body">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              {
                id: 'text',
                label: (
                  <>
                    <Hash /> Texto
                  </>
                ),
              },
              {
                id: 'voice',
                label: (
                  <>
                    <Volume2 /> Voz
                  </>
                ),
              },
            ]}
          />
          <p className="hint">{kind === 'text' ? 'Mensagens, imagens, arquivos e links.' : 'Voz, vídeo, tela e o navegador da sala — com um chat ao lado.'}</p>
          <label className="field">
            <span>Nome do canal</span>
            <input className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={kind === 'text' ? 'novo-canal' : 'Sala nova'} />
          </label>
          <label className="field">
            <span>Categoria (opcional)</span>
            <input className="input" list="categorias" value={category} maxLength={40} onChange={(e) => setCategory(e.target.value)} placeholder="Sem categoria" />
            <datalist id="categorias">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Descrição (opcional)</span>
            <input className="input" value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
        </div>
        <footer className="modal-foot">
          <Button variant="ghost" onClick={closeModal}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>
            Criar canal
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

const EXPIRES = [
  { label: 'Nunca', value: 0 },
  { label: '30 minutos', value: 1800 },
  { label: '1 hora', value: 3600 },
  { label: '1 dia', value: 86400 },
  { label: '7 dias', value: 604800 },
];
const USES = [0, 1, 5, 10, 25, 100];

export function InviteModal({ modal }: { modal: Extract<ModalState, { type: 'invite' }> }) {
  const me = useMe();
  const server = useApp((s) => s.servers[modal.serverId]);
  const friends = useApp((s) => s.friends);
  const users = useApp((s) => s.users);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [expiresIn, setExpiresIn] = useState(0);
  const [maxUses, setMaxUses] = useState(0);
  const [added, setAdded] = useState<string[]>([]);
  const { busy, error, run } = useAction();

  const create = () => run(async () => setInvite(await api.post<Invite>(`/api/servers/${modal.serverId}/invites`, { expiresIn, maxUses })));
  useEffect(() => {
    void create();
  }, [expiresIn, maxUses]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!server) return null;
  const outside = Object.values(friends)
    .filter((f) => f.status === 'accepted' && !server.members.some((m) => m.userId === f.userId))
    .map((f) => users[f.userId])
    .filter(Boolean);

  return (
    <Modal title={`Convidar pra ${server.name}`} onClose={closeModal}>
      <div className="modal-body">
        <div className="field">
          <span>Link do convite</span>
          <div className="copy-field">
            <input className="input" readOnly value={invite ? inviteLink(invite.code) : 'Gerando…'} onFocus={(e) => e.target.select()} />
            <Button variant="primary" disabled={!invite || busy} onClick={() => invite && copyText(inviteLink(invite.code), 'Link de convite copiado — é só mandar.')}>
              <Copy /> Copiar
            </Button>
          </div>
        </div>
        <div className="row invite-options">
          <label className="field grow">
            <span>Expira em</span>
            <select className="input" value={expiresIn} onChange={(e) => setExpiresIn(Number(e.target.value))}>
              {EXPIRES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Limite de usos</span>
            <select className="input" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}>
              {USES.map((n) => (
                <option key={n} value={n}>
                  {n ? `${n} ${n === 1 ? 'uso' : 'usos'}` : 'Sem limite'}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}

        {outside.length > 0 && (permsOf(server, me.id) & P.INVITE) !== 0 && (
          <div className="field">
            <span>Ou ponha um amigo direto</span>
            <div className="pick-list">
              {outside.map((user) => (
                <div key={user.id} className="pick-row">
                  <Avatar user={user} size="2rem" />
                  <span className="grow truncate">{user.name}</span>
                  {added.includes(user.id) ? (
                    <span className="ok-text row">
                      <Check size={16} /> Entrou
                    </span>
                  ) : (
                    <Button
                      small
                      onClick={() =>
                        api
                          .post(`/api/servers/${server.id}/add-friend`, { userId: user.id })
                          .then(() => setAdded((a) => [...a, user.id]))
                          .catch(toastError)
                      }
                    >
                      Adicionar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function AddToServerModal({ modal }: { modal: Extract<ModalState, { type: 'addToServer' }> }) {
  const me = useMe();
  const servers = useApp((s) => s.servers);
  const user = useApp((s) => s.users[modal.userId]);
  const options = Object.values(servers).filter((s) => permsOf(s, me.id) & P.INVITE && !s.members.some((m) => m.userId === modal.userId));
  if (!user) return null;
  return (
    <Modal title={`Pôr ${user.name} num servidor`} onClose={closeModal} size="small">
      <div className="modal-body">
        {options.length === 0 ? (
          <p className="muted-2">{user.name} já está em todos os servidores em que você pode convidar.</p>
        ) : (
          <div className="pick-list">
            {options.map((s) => (
              <button
                key={s.id}
                className={cx('pick-row', 'clickable')}
                onClick={() =>
                  api
                    .post(`/api/servers/${s.id}/add-friend`, { userId: user.id })
                    .then(closeModal)
                    .catch(toastError)
                }
              >
                <span className="pick-icon">
                  <ServerIcon server={s} />
                </span>
                <span className="grow truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

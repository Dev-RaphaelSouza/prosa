// Ajustes da pessoa: perfil, conta, aparência, acessibilidade, avisos, voz e atalhos.
import { useEffect, useRef, useState } from 'react';
import { Accessibility, Bell, Camera, Keyboard, LogOut, Mic, Palette, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../../api';
import { STATUS_LABEL, colorOf } from '../../lib/format';
import { askNotifyPermission, canNotify } from '../../lib/notify';
import { HOTKEY_ACTIONS, comboOf, setSettings, useSettings, type HotkeyAction } from '../../settings';
import { closeModal, openModal, signOut, toast, useApp, useMe, type Modal as ModalState } from '../../store';
import { Avatar, Button, ColorPicker, ImageUpload, Segmented, Setting, Toggle, cx, useAction } from '../ui';
import { Group, SettingsShell, type SettingsTab } from './Shell';
import { BACKGROUNDS } from '../../../shared/theme';
import type { Me } from '../../../shared/types';

const TABS: SettingsTab[] = [
  { id: 'perfil', name: 'Perfil', icon: <UserRound /> },
  { id: 'conta', name: 'Conta', icon: <ShieldCheck /> },
  { id: 'aparencia', name: 'Aparência', icon: <Palette /> },
  { id: 'acessibilidade', name: 'Acessibilidade', icon: <Accessibility /> },
  { id: 'avisos', name: 'Avisos', icon: <Bell /> },
  { id: 'voz', name: 'Voz e vídeo', icon: <Mic /> },
  { id: 'atalhos', name: 'Atalhos', icon: <Keyboard /> },
];

const saveMe = async (patch: Record<string, unknown>) => {
  const me = await api.patch<Me>('/api/me', patch);
  useApp.setState({ me });
  return me;
};

function ProfileTab() {
  const me = useMe();
  const [form, setForm] = useState({ name: me.name, handle: me.handle, pronouns: me.pronouns, bio: me.bio, statusText: me.statusText, banner: me.banner, avatar: me.avatar });
  const { busy, error, run, setError } = useAction();
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== me[k]);
  const field = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const banner = form.banner ?? colorOf(me.id);

  return (
    <div className="profile-edit">
      <div className="profile-edit-form">
        <label className="field">
          <span>Nome</span>
          <input className="input" value={form.name} maxLength={32} onChange={(e) => field('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Usuário</span>
          <input className="input" value={form.handle} maxLength={20} onChange={(e) => field('handle', e.target.value.toLowerCase())} autoCapitalize="none" spellCheck={false} />
          <small>É o seu @. As pessoas usam pra te adicionar e te mencionar.</small>
        </label>
        <label className="field">
          <span>Pronomes</span>
          <input className="input" value={form.pronouns} maxLength={24} onChange={(e) => field('pronouns', e.target.value)} placeholder="ela/dela, ele/dele…" />
        </label>
        <label className="field">
          <span>Status</span>
          <input className="input" value={form.statusText} maxLength={80} onChange={(e) => field('statusText', e.target.value)} placeholder="O que está rolando?" />
        </label>
        <label className="field">
          <span>Sobre</span>
          <textarea className="input" value={form.bio} maxLength={190} rows={3} onChange={(e) => field('bio', e.target.value)} />
          <small>{190 - form.bio.length} caracteres</small>
        </label>
        <div className="field">
          <span>Cor da capa</span>
          <ColorPicker value={form.banner} onChange={(c) => field('banner', c)} allowNone />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="row">
          <Button variant="primary" loading={busy} disabled={!dirty || !form.name.trim()} onClick={() => run(() => saveMe(form).then(() => toast('Perfil salvo.', 'ok')))}>
            Salvar perfil
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setForm({ name: me.name, handle: me.handle, pronouns: me.pronouns, bio: me.bio, statusText: me.statusText, banner: me.banner, avatar: me.avatar })}>
              Desfazer
            </Button>
          )}
        </div>
      </div>

      <div className="profile-preview">
        <div className="label">Prévia</div>
        <div className="profile static">
          <div className="profile-banner" style={{ background: `linear-gradient(135deg, ${banner}, color-mix(in srgb, ${banner} 55%, #000))` }} />
          <div className="profile-avatar">
            <ImageUpload onUploaded={(url) => field('avatar', url)} onError={setError}>
              <Avatar user={{ ...me, name: form.name || me.name, avatar: form.avatar }} size="5rem" status={me.status} ring="var(--bg-3)" />
              <span className="avatar-edit">
                <Camera />
              </span>
            </ImageUpload>
          </div>
          <div className="profile-body">
            <h3>{form.name || me.name}</h3>
            <p className="muted">
              @{form.handle}
              {form.pronouns && ` · ${form.pronouns}`}
            </p>
            <p className="profile-status">{form.statusText || STATUS_LABEL[me.status]}</p>
            {form.bio && <p className="profile-bio">{form.bio}</p>}
          </div>
        </div>
        <p className="hint">Clique na foto pra trocar. PNG, JPG, GIF ou WebP, até 8 MB.</p>
        {form.avatar && (
          <Button small variant="ghost" onClick={() => field('avatar', null)}>
            Remover foto
          </Button>
        )}
      </div>
    </div>
  );
}

function AccountTab() {
  const me = useMe();
  const [email, setEmail] = useState(me.email ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const mail = useAction();
  const pass = useAction();
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const del = useAction();
  return (
    <>
      <Group title="E-mail">
        <div className="group-pad">
          <div className="copy-field">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
            <Button loading={mail.busy} disabled={email === (me.email ?? '')} onClick={() => mail.run(() => saveMe({ email }).then(() => toast('E-mail salvo.', 'ok')))}>
              Salvar
            </Button>
          </div>
          <p className="hint">Opcional. Serve pra entrar (no lugar do usuário) e pra quem cuida do servidor te achar se você perder a senha.</p>
          {mail.error && <p className="error-text">{mail.error}</p>}
        </div>
      </Group>

      <Group title="Trocar a senha">
        <form
          className="group-pad"
          onSubmit={(e) => {
            e.preventDefault();
            void pass.run(async () => {
              await api.post('/api/me/password', { current, next });
              setCurrent('');
              setNext('');
              toast('Senha trocada. As outras sessões foram encerradas.', 'ok');
            });
          }}
        >
          <label className="field">
            <span>Senha atual</span>
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="field">
            <span>Senha nova</span>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <small>Mínimo de 6 caracteres.</small>
          </label>
          {pass.error && <p className="error-text">{pass.error}</p>}
          <div>
            <Button type="submit" loading={pass.busy} disabled={!current || next.length < 6}>
              Trocar a senha
            </Button>
          </div>
        </form>
      </Group>

      <Group title="Sessão">
        <Setting title="Sair da conta" desc="Você volta pra tela de entrada neste aparelho.">
          <Button onClick={() => signOut()}>
            <LogOut /> Sair
          </Button>
        </Setting>
        <Setting title="Apagar a conta" desc="Você sai de todos os servidores e a conta deixa de existir. Suas mensagens ficam, sem o seu nome.">
          <Button variant="soft-danger" onClick={() => setDeleting(!deleting)}>
            Apagar conta
          </Button>
        </Setting>
        {deleting && (
          <form
            className="group-pad"
            onSubmit={(e) => {
              e.preventDefault();
              void del.run(async () => {
                await api.post('/api/me/delete', { password: confirm });
                signOut(false);
              });
            }}
          >
            <label className="field">
              <span>Confirme com a sua senha</span>
              <input className="input" type="password" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {del.error && <p className="error-text">{del.error}</p>}
            <div>
              <Button variant="danger" type="submit" loading={del.busy} disabled={!confirm}>
                Apagar minha conta pra sempre
              </Button>
            </div>
          </form>
        )}
      </Group>
    </>
  );
}

function AppearanceTab() {
  const s = useSettings();
  return (
    <>
      <Group title="Cores">
        <div className="group-pad">
          <div className="field">
            <span>Cor de destaque</span>
            <ColorPicker value={s.accent} onChange={(accent) => accent && setSettings({ accent })} />
          </div>
          <div className="field">
            <span>Fundo</span>
            <div className="swatches">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} className={cx('swatch square', s.bg === b.id && 'on')} style={{ background: b.swatch }} onClick={() => setSettings({ bg: b.id })} data-tip={b.name} aria-label={b.name} />
              ))}
            </div>
          </div>
        </div>
        <Setting title="Usar o tema de cada servidor" desc="Quem administra um servidor pode dar cor a ele. Desligado, tudo fica com as suas cores.">
          <Toggle label="Usar o tema de cada servidor" checked={s.serverThemes} onChange={(serverThemes) => setSettings({ serverThemes })} />
        </Setting>
      </Group>

      <Group title="Leitura">
        <Setting title="Densidade" desc="Compacta junta mais as mensagens e as listas.">
          <Segmented
            value={s.density}
            onChange={(density) => setSettings({ density })}
            options={[
              { id: 'confortavel', label: 'Confortável' },
              { id: 'compacta', label: 'Compacta' },
            ]}
          />
        </Setting>
        <Setting title="Tamanho do texto" desc={`${s.scale} px`}>
          <input type="range" min={13} max={19} step={1} value={s.scale} onChange={(e) => setSettings({ scale: Number(e.target.value) })} aria-label="Tamanho do texto" style={{ width: '11rem' }} />
        </Setting>
        <Setting title="Prévia de links" desc="Mostra um cartão com título e imagem dos links mandados na conversa.">
          <Toggle label="Prévia de links" checked={s.linkPreviews} onChange={(linkPreviews) => setSettings({ linkPreviews })} />
        </Setting>
      </Group>

      <Group title="Modo trabalho">
        <Setting title="Modo trabalho" desc="Um interruptor só: lista compacta e avisos calados. Desligar devolve o que você tinha.">
          <Toggle label="Modo trabalho" checked={s.workMode} onChange={(workMode) => setSettings({ workMode })} />
        </Setting>
      </Group>
      <p className="hint">As mudanças valem na hora e ficam só neste aparelho.</p>
    </>
  );
}

function AccessibilityTab() {
  const s = useSettings();
  return (
    <Group>
      <Setting title="Reduzir movimento" desc="Corta as animações de entrada e as transições.">
        <Toggle label="Reduzir movimento" checked={s.reducedMotion} onChange={(reducedMotion) => setSettings({ reducedMotion })} />
      </Setting>
      <Setting title="Não depender só da cor" desc="Os indicadores de status ganham formas diferentes, além da cor.">
        <Toggle label="Não depender só da cor" checked={s.shapes} onChange={(shapes) => setSettings({ shapes })} />
      </Setting>
    </Group>
  );
}

function NotificationsTab() {
  const s = useSettings();
  const [permission, setPermission] = useState(canNotify() ? Notification.permission : 'unsupported');
  const enable = async (key: 'notifyMentions' | 'notifyDms', on: boolean) => {
    setSettings({ [key]: on });
    if (on && canNotify()) {
      await askNotifyPermission();
      setPermission(Notification.permission);
    }
  };
  return (
    <>
      <Group>
        <Setting title="Menções" desc="Avisa quando alguém escreve @você ou @todos e você não está olhando.">
          <Toggle label="Avisar menções" checked={s.notifyMentions} onChange={(on) => enable('notifyMentions', on)} />
        </Setting>
        <Setting title="Mensagens privadas" desc="Avisa quando chega mensagem numa conversa privada.">
          <Toggle label="Avisar mensagens privadas" checked={s.notifyDms} onChange={(on) => enable('notifyDms', on)} />
        </Setting>
        <Setting title="Sons" desc="Mensagem nova, gente entrando e saindo da chamada, microfone.">
          <Toggle label="Sons" checked={s.sounds} onChange={(sounds) => setSettings({ sounds })} />
        </Setting>
      </Group>
      {permission === 'unsupported' && <p className="hint">Este navegador não mostra avisos do sistema. Os sons e os contadores continuam funcionando.</p>}
      {permission === 'denied' && <p className="hint">O navegador bloqueou os avisos deste site. Libere nas permissões dele (o cadeado ao lado do endereço).</p>}
      {permission === 'default' && (
        <p className="hint">
          Pra aparecer o aviso do sistema, o navegador precisa da sua permissão.{' '}
          <button className="link" onClick={async () => (await askNotifyPermission(), setPermission(Notification.permission))}>
            Permitir avisos
          </button>
        </p>
      )}
      <p className="hint">Com o status em “Não perturbe” ou o modo trabalho ligado, nada toca nem aparece — só os contadores sobem.</p>
    </>
  );
}

function MicTest() {
  const micId = useSettings((s) => s.micId);
  const [level, setLevel] = useState<number | null>(null);
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);

  const toggle = async () => {
    if (stop.current) {
      stop.current();
      stop.current = undefined;
      return setLevel(null);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: micId } : true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let peak = 0;
        for (const x of samples) peak = Math.max(peak, Math.abs(x));
        setLevel(Math.min(1, peak * 2.2));
      }, 60);
      stop.current = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      setLevel(0);
    } catch {
      toast('Não deu pra abrir o microfone. Confira a permissão do navegador.', 'error');
    }
  };

  return (
    <div className="mic-test">
      <Button small onClick={toggle}>
        {level === null ? 'Testar microfone' : 'Parar teste'}
      </Button>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${(level ?? 0) * 100}%` }} />
      </div>
    </div>
  );
}

function KeyCapture({ value, onChange, code }: { value: string; onChange: (combo: string) => void; code?: boolean }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setListening(false);
      const combo = code ? e.code : comboOf(e);
      if (!combo) return;
      onChange(combo);
      setListening(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, code, onChange]);
  return (
    <div className="row">
      <button className={cx('keycap', listening && 'listening')} onClick={() => setListening(!listening)}>
        {listening ? 'Aperte a tecla…' : value ? value.replace(/\+/g, ' + ') : 'Sem atalho'}
      </button>
      {value && !listening && (
        <Button small variant="ghost" onClick={() => onChange('')}>
          Limpar
        </Button>
      )}
    </div>
  );
}

function VoiceTab() {
  const s = useSettings();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, []);

  const options = (kind: MediaDeviceKind, fallback: string) =>
    devices
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || `${fallback} ${i + 1}`}
        </option>
      ));
  // O navegador só revela o nome dos aparelhos depois de uma permissão de microfone.
  const unnamed = devices.length > 0 && devices.every((d) => !d.label);

  return (
    <>
      <Group title="Aparelhos">
        <div className="group-pad">
          <label className="field">
            <span>Microfone</span>
            <select className="input" value={s.micId} onChange={(e) => setSettings({ micId: e.target.value })}>
              <option value="">Padrão do sistema</option>
              {options('audioinput', 'Microfone')}
            </select>
          </label>
          <MicTest />
          <label className="field">
            <span>Saída de som</span>
            <select className="input" value={s.speakerId} onChange={(e) => setSettings({ speakerId: e.target.value })}>
              <option value="">Padrão do sistema</option>
              {options('audiooutput', 'Saída')}
            </select>
          </label>
          <label className="field">
            <span>Câmera</span>
            <select className="input" value={s.camId} onChange={(e) => setSettings({ camId: e.target.value })}>
              <option value="">Padrão do sistema</option>
              {options('videoinput', 'Câmera')}
            </select>
          </label>
          {unnamed && (
            <p className="hint">
              Os nomes aparecem depois que o navegador libera o microfone.{' '}
              <button
                className="link"
                onClick={() =>
                  navigator.mediaDevices
                    .getUserMedia({ audio: true })
                    .then((stream) => (stream.getTracks().forEach((t) => t.stop()), refresh()))
                    .catch(() => toast('Permissão de microfone negada.', 'error'))
                }
              >
                Liberar agora
              </button>
            </p>
          )}
        </div>
      </Group>

      <Group title="Tratamento da voz">
        <Setting title="Supressão de ruído" desc="Tira ventilador, teclado e barulho de fundo.">
          <Toggle label="Supressão de ruído" checked={s.noiseSuppression} onChange={(noiseSuppression) => setSettings({ noiseSuppression })} />
        </Setting>
        <Setting title="Cancelamento de eco" desc="Evita que os outros se ouçam de volta quando você usa caixa de som.">
          <Toggle label="Cancelamento de eco" checked={s.echoCancellation} onChange={(echoCancellation) => setSettings({ echoCancellation })} />
        </Setting>
        <Setting title="Nivelar o volume" desc="Ajusta o ganho do microfone sozinho.">
          <Toggle label="Nivelar o volume" checked={s.autoGain} onChange={(autoGain) => setSettings({ autoGain })} />
        </Setting>
      </Group>

      <Group title="Apertar pra falar">
        <Setting title="Apertar pra falar" desc="O microfone só transmite enquanto a tecla está pressionada (com o Prosa em foco e fora de um campo de texto).">
          <Toggle label="Apertar pra falar" checked={s.ptt} onChange={(ptt) => setSettings({ ptt })} />
        </Setting>
        {s.ptt && (
          <Setting title="Tecla">
            <KeyCapture code value={s.pttKey} onChange={(pttKey) => pttKey && setSettings({ pttKey })} />
          </Setting>
        )}
      </Group>
    </>
  );
}

function HotkeysTab() {
  const hotkeys = useSettings((s) => s.hotkeys);
  const set = (id: HotkeyAction, combo: string) => {
    // Duas ações não dividem a mesma combinação: a mais nova fica com ela.
    const next = { ...hotkeys, [id]: combo };
    if (combo) for (const other of HOTKEY_ACTIONS) if (other.id !== id && next[other.id] === combo) next[other.id] = '';
    setSettings({ hotkeys: next });
  };
  return (
    <>
      <Group title="Na chamada">
        {HOTKEY_ACTIONS.map((a) => (
          <Setting key={a.id} title={a.name}>
            <KeyCapture value={hotkeys[a.id]} onChange={(combo) => set(a.id, combo)} />
          </Setting>
        ))}
      </Group>
      <Group title="Sempre">
        <Setting title="Buscar e comandos">
          <span className="keycap static">Ctrl + K</span>
        </Setting>
        <Setting title="Editar a sua última mensagem">
          <span className="keycap static">↑ no campo vazio</span>
        </Setting>
      </Group>
      <p className="hint">Os atalhos funcionam em qualquer canal, com a chamada de fundo — desde que o Prosa esteja em foco. Um atalho de uma tecla só não dispara enquanto você escreve.</p>
    </>
  );
}

export default function UserSettings({ modal }: { modal: Extract<ModalState, { type: 'userSettings' }> }) {
  const tab = modal.tab && TABS.some((t) => t.id === modal.tab) ? modal.tab : 'perfil';
  return (
    <SettingsShell title="Ajustes" tabs={TABS} tab={tab} onTab={(id) => openModal({ type: 'userSettings', tab: id })} onClose={closeModal}>
      {tab === 'perfil' && <ProfileTab />}
      {tab === 'conta' && <AccountTab />}
      {tab === 'aparencia' && <AppearanceTab />}
      {tab === 'acessibilidade' && <AccessibilityTab />}
      {tab === 'avisos' && <NotificationsTab />}
      {tab === 'voz' && <VoiceTab />}
      {tab === 'atalhos' && <HotkeysTab />}
    </SettingsShell>
  );
}

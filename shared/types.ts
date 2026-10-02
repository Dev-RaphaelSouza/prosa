// Tipos que o servidor e o cliente compartilham: é o formato do que trafega em JSON.

export type Status = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface User {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
  banner: string | null;
  accent: string | null;
  bio: string;
  pronouns: string;
  status: Status;
  statusText: string;
}

export interface Me extends User {
  email: string | null;
}

export type ChannelKind = 'text' | 'voice' | 'dm';

/** Quem pode dirigir o navegador da sala: todos, um por vez (fila) ou só quem tem a permissão. */
export type DriveMode = 'livre' | 'volante' | 'poder';

export interface Channel {
  id: string;
  serverId: string | null;
  kind: ChannelKind;
  name: string;
  topic: string;
  category: string;
  position: number;
  driveMode: DriveMode;
  /** Só em DM: a outra pessoa da conversa. */
  recipientId?: string;
  /** Só em DM: id da última mensagem, usado pra ordenar a lista. */
  lastId?: number;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  color: string;
  perms: number;
  position: number;
}

export interface Member {
  userId: string;
  roles: string[];
  joinedAt: number;
}

export interface ServerTheme {
  accent?: string;
  bg?: string;
}

export interface FocusTask {
  id: string;
  text: string;
  done: boolean;
  by: string;
}

export interface Focus {
  phase: 'idle' | 'foco' | 'pausa';
  endsAt: number | null;
  focusMin: number;
  breakMin: number;
  round: number;
  tasks: FocusTask[];
}

export interface Server {
  id: string;
  name: string;
  icon: string | null;
  ownerId: string;
  theme: ServerTheme;
  /** Permissões de todo mundo (o "@todos"). */
  perms: number;
  channels: Channel[];
  roles: Role[];
  members: Member[];
  focus: Focus;
}

export interface Attachment {
  url: string;
  name: string;
  size: number;
  type: string;
  w?: number;
  h?: number;
}

export interface Reaction {
  emoji: string;
  users: string[];
}

export interface ReplyPreview {
  id: number;
  authorId: string;
  content: string;
}

export interface Message {
  id: number;
  channelId: string;
  authorId: string;
  content: string;
  /** Mensagem do sistema (ex.: 'join'). */
  kind: string | null;
  createdAt: number;
  editedAt: number | null;
  pinnedAt: number | null;
  replyTo: ReplyPreview | null;
  attachments: Attachment[];
  reactions: Reaction[];
  mentions: string[];
  everyone: boolean;
  nonce?: string;
}

export interface Friend {
  userId: string;
  status: 'accepted' | 'incoming' | 'outgoing';
}

export interface Invite {
  code: string;
  serverId: string;
  creatorId: string;
  uses: number;
  maxUses: number;
  expiresAt: number | null;
  createdAt: number;
}

export interface InvitePreview {
  code: string;
  server: { id: string; name: string; icon: string | null; members: number; online: number };
  inviter: User | null;
  member: boolean;
}

export interface Ban {
  user: User;
  reason: string;
  byId: string;
  createdAt: number;
}

export interface ModLogEntry {
  id: number;
  actorId: string;
  action: string;
  target: string;
  detail: string;
  createdAt: number;
}

export interface VoiceState {
  muted: boolean;
  deaf: boolean;
  cam: boolean;
  screen: boolean;
  hand: boolean;
  /** Ids dos MediaStreams de cada origem, pra quem recebe saber o que é câmera e o que é tela. */
  streams: { mic?: string; cam?: string; screen?: string };
}

export interface Unread {
  count: number;
  mentions: number;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface BrowserState {
  channelId: string;
  url: string;
  title: string;
  loading: boolean;
  /** Quem está com o volante (modo 'volante'). */
  driver: string | null;
  queue: string[];
  width: number;
  height: number;
}

export interface Bootstrap {
  me: Me;
  users: User[];
  servers: Server[];
  dms: Channel[];
  friends: Friend[];
  unread: Record<string, Unread>;
  voice: Record<string, Record<string, VoiceState>>;
  browsers: BrowserState[];
  ice: IceServer[];
  features: { browser: boolean };
}

export interface Profile {
  user: User;
  mutualServers: string[];
  createdAt: number;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  site: string;
}

/** Manifesto: a estrutura de um servidor em JSON, pra exportar e recriar em outro lugar. */
export interface Manifest {
  prosa: 1;
  nome: string;
  tema?: ServerTheme;
  canais: { nome: string; tipo: 'texto' | 'voz'; categoria?: string; descricao?: string }[];
  cargos: { nome: string; cor: string; permissoes: string[] }[];
}

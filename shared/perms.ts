import type { Server } from './types.ts';

/** Permissões são bits somados num número só. */
export const P = {
  ADMIN: 1,
  MANAGE_SERVER: 2,
  MANAGE_CHANNELS: 4,
  MANAGE_ROLES: 8,
  KICK: 16,
  BAN: 32,
  MANAGE_MESSAGES: 64,
  INVITE: 128,
  MENTION_ALL: 256,
  BROWSER: 512,
} as const;

export type PermKey = keyof typeof P;

export const ALL_PERMS = Object.values(P).reduce((a, b) => a | b, 0);
export const DEFAULT_PERMS = P.INVITE;

export const PERM_LIST: { key: PermKey; name: string; desc: string }[] = [
  { key: 'ADMIN', name: 'Administrador', desc: 'Tem todas as permissões. Dê com cuidado.' },
  { key: 'MANAGE_SERVER', name: 'Gerenciar servidor', desc: 'Muda nome, ícone e tema do servidor.' },
  { key: 'MANAGE_CHANNELS', name: 'Gerenciar canais', desc: 'Cria, edita e apaga canais.' },
  { key: 'MANAGE_ROLES', name: 'Gerenciar cargos', desc: 'Cria cargos e distribui os que estão abaixo do seu.' },
  { key: 'KICK', name: 'Expulsar membros', desc: 'Tira alguém do servidor e das chamadas.' },
  { key: 'BAN', name: 'Banir membros', desc: 'Tira e impede de voltar.' },
  { key: 'MANAGE_MESSAGES', name: 'Gerenciar mensagens', desc: 'Apaga mensagens dos outros e fixa mensagens.' },
  { key: 'INVITE', name: 'Criar convites', desc: 'Gera links de convite.' },
  { key: 'MENTION_ALL', name: 'Mencionar @todos', desc: 'Avisa todo mundo do servidor de uma vez.' },
  { key: 'BROWSER', name: 'Moderar o navegador', desc: 'Abre e fecha o navegador da sala, escolhe o modo e passa o volante.' },
];

export function permsOf(server: Server, userId: string): number {
  if (server.ownerId === userId) return ALL_PERMS;
  const member = server.members.find((m) => m.userId === userId);
  if (!member) return 0;
  let perms = server.perms;
  for (const role of server.roles) if (member.roles.includes(role.id)) perms |= role.perms;
  return perms & P.ADMIN ? ALL_PERMS : perms;
}

export const can = (server: Server, userId: string, bit: number) => (permsOf(server, userId) & bit) !== 0;

/** Posição do cargo mais alto: só se age sobre quem (ou o cargo que) está abaixo. */
export function rankOf(server: Server, userId: string): number {
  if (server.ownerId === userId) return Number.MAX_SAFE_INTEGER;
  const member = server.members.find((m) => m.userId === userId);
  if (!member) return -1;
  let rank = 0;
  for (const role of server.roles) if (member.roles.includes(role.id)) rank = Math.max(rank, role.position);
  return rank;
}

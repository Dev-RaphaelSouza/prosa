// Ações que mais de uma tela dispara: menus de servidor e de canal, amizade, DM, copiar.
import { CheckCheck, Copy, Hash, LogOut, Pencil, Settings, Trash2, UserPlus } from 'lucide-react';
import { api } from './api';
import { goDm, markRead, openModal, toast, toastError, useApp, type MenuItem } from './store';
import { P, permsOf } from '../shared/perms';
import type { Channel, Invite, Server } from '../shared/types';

export async function copyText(text: string, done = 'Copiado.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, 'ok');
  } catch {
    toast('Não deu pra copiar. Copie na mão: ' + text, 'error');
  }
}

export const inviteLink = (code: string) => `${location.origin}/convite/${code}`;

export async function copyInvite(serverId: string) {
  try {
    const invite = await api.post<Invite>(`/api/servers/${serverId}/invites`);
    await copyText(inviteLink(invite.code), 'Link de convite copiado — é só mandar.');
  } catch (e) {
    toastError(e);
  }
}

export async function openDm(userId: string) {
  const existing = Object.values(useApp.getState().dms).find((c) => c.recipientId === userId);
  if (existing) return goDm(existing.id);
  try {
    const { channel } = await api.post<{ channel: Channel }>('/api/dms', { userId });
    useApp.setState((s) => ({ dms: { ...s.dms, [channel.id]: channel } }));
    goDm(channel.id);
  } catch (e) {
    toastError(e);
  }
}

export const acceptFriend = (userId: string) => api.post(`/api/friends/${userId}/accept`).catch(toastError);
export const removeFriend = (userId: string) => api.del(`/api/friends/${userId}`).catch(toastError);

export const SETTINGS_PERMS = P.MANAGE_SERVER | P.MANAGE_CHANNELS | P.MANAGE_ROLES | P.KICK | P.BAN;

export function serverMenu(server: Server): MenuItem[] {
  const { me, unread } = useApp.getState();
  const perms = permsOf(server, me!.id);
  const owner = server.ownerId === me!.id;
  const items: MenuItem[] = [
    { label: 'Convidar pessoas', icon: <UserPlus />, disabled: !(perms & P.INVITE), onSelect: () => openModal({ type: 'invite', serverId: server.id }) },
    {
      label: 'Marcar tudo como lido',
      icon: <CheckCheck />,
      disabled: !server.channels.some((c) => unread[c.id]),
      onSelect: () => server.channels.forEach((c) => unread[c.id] && markRead(c.id)),
    },
  ];
  if (perms & P.MANAGE_CHANNELS) items.push({ label: 'Criar canal', icon: <Hash />, onSelect: () => openModal({ type: 'createChannel', serverId: server.id }) });
  if (perms & SETTINGS_PERMS) items.push({ label: 'Ajustes do servidor', icon: <Settings />, onSelect: () => openModal({ type: 'serverSettings', serverId: server.id }) });
  items.push({ label: '', separator: true });
  if (owner)
    items.push({
      label: 'Apagar servidor',
      icon: <Trash2 />,
      danger: true,
      onSelect: () =>
        openModal({
          type: 'confirm',
          title: `Apagar ${server.name}?`,
          body: 'Some pra todo mundo, com canais e mensagens. Não dá pra desfazer.',
          action: 'Apagar servidor',
          danger: true,
          onConfirm: () => api.del(`/api/servers/${server.id}`),
        }),
    });
  else
    items.push({
      label: 'Sair do servidor',
      icon: <LogOut />,
      danger: true,
      onSelect: () =>
        openModal({
          type: 'confirm',
          title: `Sair de ${server.name}?`,
          body: 'Você deixa de ver os canais dele até ser convidado de novo.',
          action: 'Sair',
          danger: true,
          onConfirm: () => api.post(`/api/servers/${server.id}/leave`),
        }),
    });
  return items;
}

export function channelMenu(server: Server, channel: Channel): MenuItem[] {
  const { me, unread } = useApp.getState();
  const canManage = (permsOf(server, me!.id) & P.MANAGE_CHANNELS) !== 0;
  const items: MenuItem[] = [
    { label: 'Marcar como lido', icon: <CheckCheck />, disabled: !unread[channel.id], onSelect: () => markRead(channel.id) },
    { label: 'Copiar link do canal', icon: <Copy />, onSelect: () => copyText(`${location.origin}/s/${server.id}/${channel.id}`, 'Link do canal copiado.') },
  ];
  if (canManage)
    items.push(
      { label: '', separator: true },
      { label: 'Editar canal', icon: <Pencil />, onSelect: () => openModal({ type: 'serverSettings', serverId: server.id, tab: 'canais:' + channel.id }) },
      {
        label: 'Apagar canal',
        icon: <Trash2 />,
        danger: true,
        onSelect: () =>
          openModal({
            type: 'confirm',
            title: `Apagar ${channel.kind === 'text' ? '#' : ''}${channel.name}?`,
            body: 'As mensagens do canal vão junto. Não dá pra desfazer.',
            action: 'Apagar canal',
            danger: true,
            onConfirm: () => api.del(`/api/channels/${channel.id}`),
          }),
      },
    );
  return items;
}

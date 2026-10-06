// An organization's invitations: the only way somebody new joins one. An invitation names an address
// and, optionally, the org roles given on acceptance; the person joins only by accepting it, signed in
// with that address verified. The token (and `link`, when the deployment sets INVITATION_URL) is
// answered ONCE, on create, to be sent to them. Same `request` as client.ts — same errors.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';

const enc = encodeURIComponent;

export interface Invitation {
  id: string;
  org: string;
  email: string;
  roles: string[];
  invitedBy: { id: string | null; email: string };
  /** Sent by platform staff rather than by somebody of the organization. */
  byPlatform: boolean;
  createdAt: string;
  expiresAt: string;
  organizationName?: string | null;
}

export interface InvitationCreated {
  invitation: Invitation;
  token: string;
  link: string | null;
}

export const invitationsApi = {
  list: (org: string) => request<{ invitations: Invitation[] }>(`/organizations/${enc(org)}/invitations`),
  /** 409 already_member; a pending invitation of the same address here is replaced. */
  create: (org: string, body: { email: string; roles?: string[] }) =>
    request<InvitationCreated>(`/organizations/${enc(org)}/invitations`, { method: 'POST', body: JSON.stringify(body) }),
  revoke: (org: string, id: string) =>
    request<void>(`/organizations/${enc(org)}/invitations/${enc(id)}`, { method: 'DELETE' }),
};

/** Pending invitations, newest first (org.members:read here). */
export function useInvitations(org: string, enabled = true) {
  return useQuery({
    queryKey: ['org-invitations', org],
    queryFn: () => invitationsApi.list(org),
    select: (r) => r.invitations ?? [],
    enabled: !!org && enabled,
    retry: false,
  });
}

export function useCreateInvitation(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; roles?: string[] }) => invitationsApi.create(org, body),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org-invitations', org] }),
  });
}

export function useRevokeInvitation(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invitationsApi.revoke(org, id),
    onSettled: () => qc.invalidateQueries({ queryKey: ['org-invitations', org] }),
  });
}

/** How to reach the invitation: the link when the deployment makes one, the token otherwise. */
export const invitationAddress = (r: { token: string; link: string | null }): { label: string; value: string } =>
  r.link ? { label: 'Invitation link', value: r.link } : { label: 'Invitation token', value: r.token };

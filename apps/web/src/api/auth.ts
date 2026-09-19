import { queryOptions } from '@tanstack/react-query';
import { API_ORIGIN, apiFetch, postJson } from './client.ts';

export interface Me {
  isOwner: boolean;
}

export const meQuery = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: () => apiFetch<Me>('/auth/me'),
  // The API answers `no-store`; a stale "signed in" after a logout elsewhere is
  // the one thing this must not show, so refetch on every mount.
  staleTime: 0,
});

/**
 * A plain link, not a fetch: the login is a top-level navigation through
 * GitHub and back, and the API sets the state cookie on the way out.
 */
export function loginUrl(next: string): string {
  const params = new URLSearchParams({ next });
  return `${API_ORIGIN}/auth/github/login?${params.toString()}`;
}

export function logout(): Promise<void> {
  return postJson<void>('/auth/logout');
}

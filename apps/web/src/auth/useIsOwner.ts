import { useQuery } from '@tanstack/react-query';
import { meQuery } from '../api/auth.ts';

/**
 * Whether the viewer may change anything.
 *
 * False while the answer is still in flight, and false when the API cannot be
 * reached. Both are the right way round: a control that appears a moment late
 * is better than one that appears and then vanishes under the pointer, and the
 * API refuses the write either way — this only decides what is worth offering.
 */
export function useIsOwner(): boolean {
  return useQuery(meQuery).data?.isOwner ?? false;
}

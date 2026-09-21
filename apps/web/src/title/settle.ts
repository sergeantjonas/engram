import { useQueryClient } from '@tanstack/react-query';
import { titleQuery } from '../api/titles.ts';

/**
 * Refetches what a write to this title changed.
 *
 * The wall as well as the page: a mark moves a card's fraction and can move it
 * from still going to finished, and excluding a title takes the card off the
 * wall altogether. `['titles']` prefixes both cached variants of the wall
 * query, so the one call covers the excluded listing too.
 */
export function useSettle(titleId: string): () => Promise<unknown> {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: titleQuery(titleId).queryKey }),
      queryClient.invalidateQueries({ queryKey: ['titles'] }),
    ]);
}

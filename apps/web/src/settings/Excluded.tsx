import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  nextUpQuery,
  posterUrl,
  setIntent,
  type TitleSummary,
  titleQuery,
  titlesQuery,
} from '../api/titles.ts';
import { useToast } from '../shell/Toasts.tsx';
import { Section } from '../title/Section.tsx';

const KIND_LABEL: Record<TitleSummary['kind'], string> = { show: 'Series', movie: 'Film' };

/**
 * The titles the owner has said are not theirs, gathered in one place.
 *
 * Excluding takes a title off the wall, which is the point of the flag — and
 * also means the wall's own toggle is the only way back to it, mixed in with
 * everything else. This is the view of only the rejects, so a mistaken
 * exclusion is a list to scan rather than a title to remember.
 */
export function Excluded() {
  const { data } = useSuspenseQuery(titlesQuery({ includeExcluded: true }));
  const queryClient = useQueryClient();
  const toast = useToast();
  const excluded = data.titles
    .filter((title) => title.excluded)
    .sort((a, b) => a.name.localeCompare(b.name));

  const restore = useMutation({
    mutationFn: (title: TitleSummary) => setIntent(title.id, { excluded: false }),
    onSuccess: (_result, title) => {
      // The row leaves this list on the refetch, so the notice is what says
      // where it went.
      toast({ message: `${title.name} is back on the wall.` });
      // The same set `useSettle` refetches: a restored show is back in the
      // running for the next-up band as well as the wall.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['titles'] }),
        queryClient.invalidateQueries({ queryKey: titleQuery(title.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: nextUpQuery().queryKey }),
      ]);
    },
    onError: (error) => toast({ message: `Could not restore that: ${error.message}` }),
  });

  return (
    <Section heading="Excluded titles" aside={String(excluded.length)}>
      {excluded.length === 0 ? (
        <p className="text-sm text-dim">Nothing is excluded.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {excluded.map((title) => {
            const poster = posterUrl(title.posterPath);
            return (
              <li key={title.id} className="flex items-center gap-3 py-2">
                <div className="aspect-2/3 w-8 flex-none overflow-hidden rounded-sm bg-surf">
                  {poster ? <img src={poster} alt="" className="size-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    to="/titles/$id"
                    params={{ id: title.id }}
                    className="block truncate text-sm font-semibold text-tx underline-offset-4 hover:underline"
                  >
                    {title.name}
                  </Link>
                  <p className="font-mono text-[10px] text-dim">
                    {KIND_LABEL[title.kind]}
                    {title.year === null ? '' : ` · ${title.year}`}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Restore ${title.name}`}
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(title)}
                  className="rounded border border-line px-3 py-1.5 text-sm text-dim hover:border-dim hover:text-tx disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

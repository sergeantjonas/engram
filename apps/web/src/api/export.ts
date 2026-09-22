import { queryOptions } from '@tanstack/react-query';
import { API_ORIGIN, apiFetch } from './client.ts';

/** What the export will hold, as `GET /export` answers it. */
export interface RecordSummary {
  titles: number;
  events: number;
  /** Entered by hand: nothing but the owner's word stands behind them. */
  manual: number;
}

export const exportQuery = queryOptions({
  queryKey: ['export'],
  queryFn: () => apiFetch<RecordSummary>('/export'),
});

/**
 * A plain link, not a fetch: the API sends the file as an attachment, so the
 * browser saves it as it streams in, and the session cookie goes along with a
 * top-level navigation the way it does for the sign-in.
 */
export const recordUrl = (format: 'csv' | 'json') => `${API_ORIGIN}/export/record.${format}`;

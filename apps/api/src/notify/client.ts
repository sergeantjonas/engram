/**
 * One message as the notify hub takes it. `key` is what the hub delivers once,
 * so posting the same one again is a no-op. The limits are the hub's; a
 * message past them is refused, not trimmed.
 */
export interface NotifyMessage {
  /** At most 200 characters, no whitespace. */
  key: string;
  /** At most 256 characters. */
  title: string;
  /** At most 2000 characters. */
  body?: string;
  /** http or https, at most 2048 characters. */
  url?: string;
}

export const TITLE_MAX = 256;
export const BODY_MAX = 2000;

/**
 * What one post means for the message.
 *
 * - `taken`: the hub has it, new or a key it already had.
 * - `refused`: the hub says the message itself is wrong, which sending it
 *   again cannot change.
 * - `unavailable`: the hub does not have it — down, unreachable, or refusing
 *   the secret — and every other message would fare the same.
 */
export type PostOutcome =
  | { outcome: 'taken'; duplicate: boolean }
  | { outcome: 'refused'; status: number; reason: string | null }
  | { outcome: 'unavailable'; status: number | null };

export interface NotifyClient {
  post(message: NotifyMessage): Promise<PostOutcome>;
}

export interface NotifyClientOptions {
  origin: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const TIMEOUT_MS = 10_000;

/** A 400 is a body the hub's schema refused, a 413 one past its size limit. */
const REFUSED = new Set([400, 413]);

function fieldOf(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null && name in body
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

export function createNotifyClient(options: NotifyClientOptions): NotifyClient {
  const { origin, secret, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = options;
  const url = new URL('/messages', origin);

  return {
    async post(message) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { outcome: 'unavailable', status: null };
      }

      // A 202 and nothing else: a proxy answering 200 in the hub's place — a
      // site with no handler, a parking page — would otherwise mark every
      // alert delivered and lose it.
      if (response.status === 202) {
        // Read for the log alone; the status already says the hub stored it.
        const body: unknown = await response.json().catch(() => null);
        return { outcome: 'taken', duplicate: fieldOf(body, 'duplicate') === true };
      }

      if (REFUSED.has(response.status)) {
        // A refused alert is never sent again, so the hub's reason is the only
        // record of why. It names fields and rules, never what was sent.
        const body: unknown = await response.json().catch(() => null);
        const reason = fieldOf(body, 'message');
        return {
          outcome: 'refused',
          status: response.status,
          reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
        };
      }

      // Unread, an error body holds its connection open until it is collected.
      await response.body?.cancel().catch(() => undefined);
      return { outcome: 'unavailable', status: response.status };
    },
  };
}

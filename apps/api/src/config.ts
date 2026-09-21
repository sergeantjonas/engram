import { z } from 'zod';

/**
 * Engram runs on a different host from the media stack, so every inbound
 * webhook crosses the public internet. `WEBHOOK_SECRET` is what stops an
 * unauthenticated stranger writing into the watch history, and there is no
 * sensible default for it.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(16, 'WEBHOOK_SECRET must be at least 16 characters'),
  // Away from 3000, which every other Node project on a box also wants, and
  // next to the ports `vyoh.gg` already claims so the two read as a group. It
  // is baked into the OAuth app's callback URL, so moving it is not free.
  PORT: z.coerce.number().int().positive().default(2012),
  // Loopback by default: this runs on a public VPS behind a TLS proxy, and
  // binding every interface would expose unauthenticated routes directly.
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TMDB_API_KEY: z.string().optional(),

  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),

  /**
   * The owner's numeric GitHub id, never the login. A login can be renamed and
   * the freed name claimed by someone else, who would then inherit the watch
   * history; the id is permanent.
   */
  OWNER_GITHUB_USER_ID: z
    .string()
    .regex(/^[1-9]\d*$/, 'OWNER_GITHUB_USER_ID must be the numeric id, not the login'),

  /**
   * Whose plays may be stored, as Plex account ids.
   *
   * The server is shared. A housemate's viewing landing in this record would
   * be wrong twice over: the figures stop describing anyone, and the app
   * starts keeping a log of what somebody else watched without being asked.
   * So the allowlist is enforced where events are planned and a play by
   * anyone else is dropped rather than written — filtering on read would
   * leave the row on disk, which is the part that needed consent.
   *
   * Defaults to `1`, which is the server owner on every Plex install and was
   * verified as this owner's on 2026-09-17: all 86 history rows carry it, and
   * every other account id on the server returns nothing. Set it explicitly
   * for a Plex Home profile or a second person's ingest.
   */
  PLEX_ACCOUNT_IDS: z
    .string()
    .default('1')
    .transform((raw) =>
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    )
    .refine(
      (ids) => ids.length > 0 && ids.every((id) => /^(0|[1-9]\d*)$/.test(id)),
      'PLEX_ACCOUNT_IDS must be one or more numeric Plex account ids, comma separated',
    ),

  /**
   * Whose plays Tautulli may report, as Tautulli's own user ids.
   *
   * Separate from `PLEX_ACCOUNT_IDS` because the two are different
   * namespaces, which is a thing measured rather than assumed: for the same
   * owner, Plex's history endpoint says account `1` and Tautulli's
   * `{user_id}` says `7597797`, while the server's shared users carry ids
   * shaped like the second. One list holding both would work and then fail
   * the first time somebody adds a Plex account id here to exclude a
   * housemate and nothing happens, because it is the wrong namespace for
   * this source.
   *
   * Empty by default, and empty rejects everyone. A write path cannot be
   * opened by omission — the same rule the route guard follows — so an
   * unconfigured webhook records nothing rather than everything.
   */
  TAUTULLI_USER_IDS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    )
    .refine(
      (ids) => ids.every((id) => /^(0|[1-9]\d*)$/.test(id)),
      'TAUTULLI_USER_IDS must be numeric Tautulli user ids, comma separated',
    ),

  /**
   * Signs the OAuth `state` and nothing else. The floor is what
   * `openssl rand -hex 32` produces, so a passphrase short enough to guess
   * cannot be substituted for it.
   */
  OAUTH_STATE_SECRET: z.string().min(64, 'OAUTH_STATE_SECRET must be at least 64 characters'),

  /**
   * The SPA's origin: the CORS allowlist and the absolute target of the
   * post-login redirect. A bare origin because `next` is appended to it, and a
   * trailing slash would build `//path`, which a browser reads as a host.
   */
  WEB_ORIGIN: z.url('WEB_ORIGIN must be an absolute URL').refine(
    (value) => {
      const url = URL.parse(value);
      // The scheme is checked too: `ftp://x` has a real origin as far as the
      // URL parser is concerned, and would sit in the CORS allowlist as a
      // value no browser can ever send.
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false;
      return url.origin === value;
    },
    {
      message:
        'WEB_ORIGIN must be exactly the origin a browser sends: http or https, ' +
        'lowercase, no default port, credentials, path, query or fragment',
    },
  ),

  /** Unset in development, where the API and the SPA are both on localhost. */
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),
});

export type Config = z.infer<typeof schema>;

function orThrow<T>(result: z.ZodSafeParseResult<T>): T {
  if (result.success) return result.data;
  // The issues only, never the values: half of these variables are secrets.
  const issues = result.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid configuration:\n${issues}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return orThrow(schema.safeParse(env));
}

/**
 * Just the database, for the entry points that run once and exit.
 *
 * `db:migrate` and `import:plex` read nothing else, and making them parse the
 * whole environment would mean a fresh deploy had to register an OAuth app
 * before it could create its tables.
 */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return orThrow(schema.pick({ DATABASE_URL: true }).safeParse(env)).DATABASE_URL;
}

/** The same, for the allowlist the one-shot importers have to honour too. */
export function loadPlexAccountIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return orThrow(schema.pick({ PLEX_ACCOUNT_IDS: true }).safeParse(env)).PLEX_ACCOUNT_IDS;
}

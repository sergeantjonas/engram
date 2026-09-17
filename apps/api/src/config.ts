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

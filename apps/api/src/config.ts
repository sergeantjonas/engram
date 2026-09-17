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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

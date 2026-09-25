import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client.js';
import { nowWatching } from '../live/now-watching.js';
import type { LiveSessions } from '../live/sessions.js';

export function registerNowWatchingRoutes(
  app: FastifyInstance,
  db: Database,
  live: LiveSessions,
): void {
  app.get('/now-watching', async () => ({ nowWatching: await nowWatching(db, live) }));
}

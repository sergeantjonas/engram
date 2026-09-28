import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { secretMatches } from '../auth/secret.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { storeLibrary } from '../ingest/library-store.js';
import { checkComplete, type PlexLibrarySection, planLibrary } from '../ingest/plex-library.js';

/**
 * Fastify's default of 1 MiB refuses this library's walk, which is 2 MB
 * pretty-printed and grows with every episode watched. Raised on this route
 * alone, and only reached by a caller that has already proved the secret.
 */
const BODY_LIMIT = 16 * 1024 * 1024;

const count = z.number().int().nonnegative();

/**
 * The fields `planLibrary` reads, typed. Loose, not strict: the item is
 * stored whole as each event's `raw`, and stripping what this does not name
 * would lose the part of the payload a normalizer bug needs to be recovered.
 */
const leaf = z.looseObject({
  ratingKey: z.string().optional(),
  parentIndex: count.optional(),
  index: count.optional(),
  title: z.string().optional(),
  viewCount: count.optional(),
  lastViewedAt: count.optional(),
});

const item = z.looseObject({
  ratingKey: z.string().optional(),
  title: z.string().optional(),
  year: z.number().int().optional(),
  guid: z.string().optional(),
  viewCount: count.optional(),
  viewedLeafCount: count.optional(),
  lastViewedAt: count.optional(),
  episodes: z.array(leaf).optional(),
});

/** What `tools/dump-library.mjs` writes, with the count the CLI can do without. */
export const libraryWalk = z.object({
  server: z.string().optional(),
  machineIdentifier: z.string(),
  summary: z.looseObject({ items: count }),
  sections: z.array(
    z.object({ key: z.string(), type: z.string(), title: z.string(), items: z.array(item) }),
  ),
});

/**
 * The nightly library walk: the correctness half of ingest.
 *
 * Posted from the Bytesized slot, which holds the Plex token this box is not
 * allowed to, so the planner and the writer run here and the walk itself runs
 * there. Everything `import:library` refuses is refused here too, plus a walk
 * of any server but this one's.
 */
export function registerIngestRoutes(app: FastifyInstance, config: Config, db: Database): void {
  app.post(
    '/ingest/plex-library',
    {
      bodyLimit: BODY_LIMIT,
      // Before the body is read rather than in the handler, so a caller
      // without the secret cannot make this process parse sixteen megabytes.
      onRequest: async (request, reply) => {
        const secret = config.INGEST_SECRET;
        // Said without naming what is missing: this route is open to anyone
        // who can reach the API, and a stranger should learn nothing more.
        if (secret === undefined) {
          return reply
            .code(503)
            .send({ error: 'ingest_unavailable', message: 'library ingest is not configured' });
        }

        // A bearer header: the walker is ours and sends what it is told to,
        // so nothing has to travel in the body the way Tautulli's token does.
        const header = request.headers.authorization;
        const offered = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
        if (!secretMatches(offered, secret)) {
          request.log.warn(
            { offeredLength: offered?.length ?? 0, expectedLength: secret.length },
            'library ingest rejected',
          );
          return reply.code(401).send({ error: 'unauthorized' });
        }

        if (config.PLEX_SERVER_ID === undefined) {
          return reply
            .code(503)
            .send({ error: 'ingest_unavailable', message: 'PLEX_SERVER_ID is not configured' });
        }
      },
    },
    async (request, reply) => {
      const parsed = libraryWalk.safeParse(request.body);
      if (!parsed.success) {
        // Paths and messages, capped: a malformed walk can fail on every one
        // of its items, and the first few say what went wrong.
        const message = parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        return reply.code(400).send({ error: 'bad_request', message });
      }
      const walk = parsed.data;

      if (walk.machineIdentifier !== config.PLEX_SERVER_ID) {
        // The identifier, not only the name: a mistyped PLEX_SERVER_ID is the
        // likeliest reason to be here, and the log is where it gets compared.
        request.log.warn(
          { server: walk.server, machineIdentifier: walk.machineIdentifier },
          'library walk of another server refused',
        );
        return reply
          .code(422)
          .send({ error: 'wrong_server', message: 'this walk is of a different Plex server' });
      }

      // Validated above against every field the planner reads; the cast only
      // bridges zod's `T | undefined` optionals to the interfaces' own.
      const plan = planLibrary(walk.sections as PlexLibrarySection[]);
      const complete = checkComplete(walk.summary.items, plan);
      if (!complete.ok) {
        return reply.code(422).send({ error: 'incomplete', message: complete.reason });
      }

      const stored = await storeLibrary(db, plan, new Date());
      request.log.info(
        { ...stored, dropped: plan.dropped.length, incomplete: plan.incomplete.length },
        'library walk stored',
      );
      // The lists, not only their lengths: the walker's log on the slot is
      // where someone reads why a title was short or left out.
      return reply.send({ ...stored, dropped: plan.dropped, incomplete: plan.incomplete });
    },
  );
}

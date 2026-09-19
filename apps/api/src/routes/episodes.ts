import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { episodeGaps, episodes as episodeTable } from '../db/schema.js';
import type { EpisodeGap } from '../titles/detail.js';

const params = z.object({ id: z.uuid('id must be the id of a stored episode') });

const gapBody = z.object({
  reason: z.enum(['skipped', 'missing']),
  /**
   * Bounded because it is free text on a public write path, and trimmed to
   * nothing becomes null — an empty note and no note are the same thing.
   */
  note: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || null)
    .nullable()
    .optional(),
});

/**
 * What the viewer says about a hole in a season.
 *
 * Separate from `watch_event` on purpose: an event is a fact about something
 * that happened, and this is an account of something that did not. Nothing here
 * is append-only — it is a current answer, and changing your mind overwrites.
 *
 * No `plan*()` split, unlike the other write paths: there is no decision to
 * make between validating the body and writing the row, so a pure function
 * here would take two fields and return the same two fields.
 */
export function registerEpisodeRoutes(app: FastifyInstance, db: Database): void {
  app.put('/episodes/:id/gap', async (request, reply) => {
    const id = params.safeParse(request.params);
    if (!id.success) {
      const message = id.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    const body = gapBody.safeParse(request.body);
    if (!body.success) {
      const message = body.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    // Checked rather than left to the foreign key: a violation would surface as
    // a 500 quoting a constraint name, and "no such episode" is a 404.
    const [episode] = await db
      .select({ id: episodeTable.id })
      .from(episodeTable)
      .where(eq(episodeTable.id, id.data.id))
      .limit(1);

    if (!episode) {
      return reply.code(404).send({ error: 'not_found', message: 'no episode has that id' });
    }

    const note = body.data.note ?? null;
    await db
      .insert(episodeGaps)
      .values({ episodeId: id.data.id, reason: body.data.reason, note })
      .onConflictDoUpdate({
        target: episodeGaps.episodeId,
        // Postgres' clock on both paths: the insert takes `now()` from the
        // column default, and a Node `Date` here would mean one column written
        // from two clocks.
        set: { reason: body.data.reason, note, recordedAt: sql`now()` },
      });

    // Typed against what the grid reads, so the write and the read cannot
    // drift apart once the SPA consumes both.
    const gap: EpisodeGap = { reason: body.data.reason, note };
    return reply.send({ gap });
  });

  /** Clearing is saying nothing, which is not the same as saying "not skipped". */
  app.delete('/episodes/:id/gap', async (request, reply) => {
    const id = params.safeParse(request.params);
    if (!id.success) {
      const message = id.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    // Idempotent: clearing a comment that was never made is a success, because
    // the caller wanted there to be none and there is none.
    await db.delete(episodeGaps).where(eq(episodeGaps.episodeId, id.data.id));

    return reply.code(204).send();
  });
}

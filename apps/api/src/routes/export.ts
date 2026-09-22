import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Database } from '../db/client.js';
import { recordCsv, recordJson, recordSummary, recordTitles } from '../export/record.js';

/**
 * The whole record as a file, for the owner.
 *
 * Owner-only by being absent from the guard's open list, not by a check here:
 * the history is public, but the export also carries what the owner wrote to
 * themselves about titles, and the wall already decides a stranger does not
 * see that.
 *
 * Streamed rather than assembled: the events are written as each page comes
 * back from Postgres, so the file costs the API one page of memory however
 * long the record grows.
 *
 * No HEAD route for the files. Fastify answers one by running the GET and
 * draining its body, which here is the entire export for a request that
 * wanted none of it.
 */
export function registerExportRoutes(app: FastifyInstance, db: Database): void {
  // What the download will hold, said before it is taken.
  app.get('/export', async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await recordSummary(db)),
  );

  app.get('/export/record.csv', { exposeHeadRoute: false }, async (_request, reply) =>
    download(reply, 'csv', 'text/csv; charset=utf-8', Readable.from(recordCsv(db))),
  );

  app.get('/export/record.json', { exposeHeadRoute: false }, async (_request, reply) => {
    // Before the first byte, so a failure here is an error response rather
    // than an error body saved under the export's file name.
    const titles = await recordTitles(db);
    return download(
      reply,
      'json',
      'application/json; charset=utf-8',
      Readable.from(recordJson(db, new Date(), titles)),
    );
  });
}

function download(reply: FastifyReply, extension: string, type: string, body: Readable) {
  // Past the headers the error handler cannot answer any more, and Fastify
  // notes the broken stream only as a warning. The download ends short — a
  // JSON file that will not parse, a CSV missing its tail — so the log is
  // where it has to be said that it did.
  body.on('error', (err) => reply.log.error({ err }, 'export failed mid-stream'));
  const day = new Date().toISOString().slice(0, 10);
  return reply
    .header('content-type', type)
    .header('content-disposition', `attachment; filename="engram-record-${day}.${extension}"`)
    .header('cache-control', 'no-store')
    .send(body);
}

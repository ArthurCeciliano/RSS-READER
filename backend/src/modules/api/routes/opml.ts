import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { parseOpml } from '../../opml/opmlParser.js';
import { buildImportPlan, persistImportPlan } from '../../opml/opmlImporter.js';
import { createPrismaSourceWriter } from '../../opml/prismaSourceWriter.js';
import { createImportJob, getImportJob, updateImportJob } from '../../opml/importJobs.js';
import { exportOpml } from '../../opml/opmlExporter.js';

export async function opmlRoutes(app: FastifyInstance) {
  app.post('/api/opml/import', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no file uploaded' });
    const xml = (await file.toBuffer()).toString('utf-8');
    const skipExisting = (req.query as { skipExisting?: string }).skipExisting !== 'false';

    const jobId = createImportJob();
    const plan = buildImportPlan(parseOpml(xml));
    const writer = createPrismaSourceWriter(prisma);

    // Runs after we respond so the client can poll /api/opml/import/:jobId for progress,
    // per module 4's "importação assíncrona com barra de progresso" requirement.
    void persistImportPlan(plan, writer, {
      skipExisting,
      onProgress: (processed, total) => updateImportJob(jobId, { processed, total }),
    })
      .then((report) => updateImportJob(jobId, { status: 'done', report }))
      .catch((err) => updateImportJob(jobId, { status: 'error', error: err instanceof Error ? err.message : String(err) }));

    return reply.code(202).send({ jobId });
  });

  app.get<{ Params: { jobId: string } }>('/api/opml/import/:jobId', async (req, reply) => {
    const job = getImportJob(req.params.jobId);
    if (!job) return reply.code(404).send({ error: 'unknown job' });
    return job;
  });

  app.get('/api/opml/export', async (req, reply) => {
    const [folders, sources] = await Promise.all([
      prisma.folder.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.source.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    const byFolder = new Map<string, typeof sources>();
    for (const s of sources) {
      if (!s.folderId) continue;
      if (!byFolder.has(s.folderId)) byFolder.set(s.folderId, []);
      byFolder.get(s.folderId)!.push(s);
    }
    const xml = exportOpml(
      folders.map((f) => ({
        name: f.name,
        sources: (byFolder.get(f.id) ?? []).map((s) => ({
          title: s.title,
          identityUrl: s.identityUrl,
          feedUrl: s.feedUrl,
          siteUrl: s.siteUrl,
          type: s.type,
        })),
      })),
    );
    reply.header('Content-Type', 'text/x-opml+xml');
    reply.header('Content-Disposition', 'attachment; filename="feeds.opml"');
    return reply.send(xml);
  });
}

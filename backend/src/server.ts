import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env } from './config/env.js';
import { foldersRoutes } from './modules/api/routes/folders.js';
import { sourcesRoutes } from './modules/api/routes/sources.js';
import { itemsRoutes } from './modules/api/routes/items.js';
import { opmlRoutes } from './modules/api/routes/opml.js';
import { settingsRoutes } from './modules/api/routes/settings.js';
import { statsRoutes } from './modules/api/routes/stats.js';
import { rulesRoutes } from './modules/api/routes/rules.js';
import { tagsRoutes } from './modules/api/routes/tags.js';

// Combined-deploy mode (module 1: single Render Web Service instead of separate
// worker/static-site services) — importing this starts the BullMQ worker in the
// same process, side-effect only, nothing to reference here.
if (env.runWorkerInProcess) await import('./modules/queue/worker.js');

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart);

app.get('/api/health', async () => ({ status: 'ok' }));

// Surface a JSON error message instead of an opaque 500 with no body — the
// frontend shows this text directly, which matters a lot when debugging a
// deployed instance where you can't easily see server logs.
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const statusCode = error.statusCode ?? 500;
  reply.code(statusCode).send({ error: error.message || 'internal error' });
});

await app.register(foldersRoutes);
await app.register(sourcesRoutes);
await app.register(itemsRoutes);
await app.register(opmlRoutes);
await app.register(settingsRoutes);
await app.register(statsRoutes);
await app.register(rulesRoutes);
await app.register(tagsRoutes);

if (env.serveFrontend) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  await app.register(fastifyStatic, {
    root: path.resolve(dir, env.frontendDistPath),
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

app.listen({ port: env.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { callsRouter } from './routes/calls.js';
import { calibrationRouter } from './routes/calibration.js';
import { blastRadiusRouter } from './routes/blastRadius.js';
import { slaRouter } from './routes/sla.js';
import { abRouter } from './routes/abTests.js';
import { hallucinationRouter } from './routes/hallucinationSuite.js';
import { healingRouter } from './routes/healing.js';
import { exportRouter } from './routes/export.js';
import { samplesRouter } from './routes/samples.js';
import { adminRouter } from './routes/admin.js';
import { opsRouter } from './routes/ops.js';

export function createServer() {
  const app = express();
  // Behind Railway/Cloudflare, so req.ip is the real client, not the proxy.
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));

  // Friendly root — API-only server, so we tell visitors where the docs / app live.
  app.get('/', (_req, res) => {
    res.json({
      service: 'CallAutopsy backend',
      status: 'running',
      docs: 'https://github.com/pradhanashwarya2122/CallAutopsy',
      endpoints: {
        health: '/health',
        readiness: '/health/ready',
        calls: '/calls',
        ws: '/ws',
      },
    });
  });

  // /health (liveness) + /health/ready (deep readiness) provided by opsRouter.
  app.use(opsRouter);
  app.use(callsRouter);
  app.use(calibrationRouter);
  app.use(blastRadiusRouter);
  app.use(slaRouter);
  app.use(abRouter);
  app.use(hallucinationRouter);
  app.use(healingRouter);
  app.use(exportRouter);
  app.use(samplesRouter);
  app.use(adminRouter);

  // Async route errors (bad UUID, DB blip, oversize upload) land here instead of hanging the request.
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    if (err?.code === 'LIMIT_FILE_SIZE') {
      const max = Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024;
      return res.status(413).json({ error: 'audio_too_large', maxBytes: max, message: `Audio must be under ${Math.round(max / 1024 / 1024)} MB.` });
    }
    if (err?.code === '22P02') return res.status(404).json({ error: 'not_found' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message ?? 'bad_request' });
    console.error('[http]', req.method, req.path, err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

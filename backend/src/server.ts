import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { callsRouter } from './routes/calls.js';
import { demoRouter } from './routes/demo.js';
import { calibrationRouter } from './routes/calibration.js';
import { blastRadiusRouter } from './routes/blastRadius.js';
import { slaRouter } from './routes/sla.js';
import { abRouter } from './routes/abTests.js';
import { hallucinationRouter } from './routes/hallucinationSuite.js';
import { healingRouter } from './routes/healing.js';
import { statusRouter } from './routes/status.js';
import { exportRouter } from './routes/export.js';
import { samplesRouter } from './routes/samples.js';
import { adminRouter } from './routes/admin.js';
import { opsRouter } from './routes/ops.js';

export function createServer() {
  const app = express();
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
        status: '/status',
        calls: '/calls',
        ws: '/ws',
      },
    });
  });

  // /health (liveness) + /health/ready (deep readiness) provided by opsRouter.
  app.use(opsRouter);
  app.use(callsRouter);
  app.use(demoRouter);
  app.use(calibrationRouter);
  app.use(blastRadiusRouter);
  app.use(slaRouter);
  app.use(abRouter);
  app.use(hallucinationRouter);
  app.use(healingRouter);
  app.use(statusRouter);
  app.use(exportRouter);
  app.use(samplesRouter);
  app.use(adminRouter);

  return app;
}

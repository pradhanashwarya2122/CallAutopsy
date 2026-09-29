import { Queue, Worker } from 'bullmq';
import { redisConnection } from './connection.js';
import { runCall, type RunCallOpts } from '../pipeline/orchestrator.js';
import { addToDLQ } from './dlq.js';

export const CALL_QUEUE = 'call-runs';

// The queue transports audio as base64 so the job payload is JSON-safe.
// runCall itself expects a Buffer, so we swap on the way in / out.
export type EnqueuedCallJob = Omit<RunCallOpts, 'audio'> & { audioBase64: string };

export const callQueue = new Queue(CALL_QUEUE, { connection: redisConnection });

export function startCallWorker() {
  return new Worker(
    CALL_QUEUE,
    async (job) => {
      const data = job.data as EnqueuedCallJob;
      const { audioBase64, ...rest } = data;
      const audio = Buffer.from(audioBase64, 'base64');
      const { callId } = await runCall({ ...rest, audio });
      return { callId };
    },
    {
      connection: redisConnection,
      concurrency: 2,
      settings: {
        backoffStrategy: (attempts) => Math.min(30000, 1000 * 2 ** attempts),
      },
    },
  ).on('failed', async (job, err) => {
    if (job && (job.attemptsMade >= (job.opts.attempts ?? 3))) {
      await addToDLQ(job.name, job.data, err?.message ?? 'unknown');
    }
  });
}

export async function enqueueCall(data: EnqueuedCallJob) {
  const job = await callQueue.add('run', data, {
    attempts: 3,
    backoff: { type: 'custom' },
    removeOnComplete: 500,
    removeOnFail: 500,
  });
  return job.id!;
}

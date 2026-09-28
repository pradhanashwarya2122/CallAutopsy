import { Queue, Worker } from 'bullmq';
import { redisConnection } from './connection.js';
import { runCall, type RunCallOpts } from '../pipeline/orchestrator.js';
import { addToDLQ } from './dlq.js';

export const CALL_QUEUE = 'call-runs';

export const callQueue = new Queue(CALL_QUEUE, { connection: redisConnection });

export function startCallWorker() {
  return new Worker(
    CALL_QUEUE,
    async (job) => {
      const data = job.data as RunCallOpts & { audioBase64: string };
      const audio = Buffer.from(data.audioBase64, 'base64');
      const { callId } = await runCall({ ...data, audio });
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

export async function enqueueCall(data: RunCallOpts & { audioBase64: string }) {
  const job = await callQueue.add('run', data, {
    attempts: 3,
    backoff: { type: 'custom' },
    removeOnComplete: 500,
    removeOnFail: 500,
  });
  return job.id!;
}

import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';

export const DLQ_NAME = 'call-runs-dlq';
export const dlq = new Queue(DLQ_NAME, { connection: redisConnection });

export async function addToDLQ(jobName: string, data: any, error: string) {
  await dlq.add(jobName, { data, error, deadLetteredAt: new Date().toISOString() }, { removeOnComplete: false });
}

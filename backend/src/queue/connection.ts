import IORedis from 'ioredis';
import 'dotenv/config';

// BullMQ requires `maxRetriesPerRequest: null` for workers, but we still want
// TLS support (Upstash uses rediss://) and a bounded connect timeout so the
// pod doesn't just sit there stuck if REDIS_URL is wrong.
const url = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisConnection = new IORedis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10_000,
  // Upstash + most managed Redis use TLS via rediss://
  ...(url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}),
});

redisConnection.on('error', (err) => {
  console.error('[redis]', err.message);
});

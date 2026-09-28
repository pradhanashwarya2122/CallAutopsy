import fs from 'node:fs/promises';
import path from 'node:path';

// Storage abstraction with a filesystem driver by default and an
// S3-compatible driver (R2, Backblaze, MinIO, S3) when configured.
//
// Set STORAGE_DRIVER=s3 and STORAGE_S3_* env vars to switch. Falls back
// to local disk otherwise — fine for dev but wiped on every Railway
// redeploy in production. See README.

const DRIVER = (process.env.STORAGE_DRIVER ?? 'fs').toLowerCase();
const LOCAL_BASE = path.resolve(process.cwd(), 'storage', 'audio');

interface Driver {
  saveInput(callId: string, buf: Buffer, ext: string): Promise<string>;
  saveTts(callId: string, buf: Buffer): Promise<string>;
  read(callId: string, kind: 'input' | 'tts'): Promise<{ buf: Buffer; contentType: string } | null>;
}

// ---------- filesystem driver ----------
const fsDriver: Driver = {
  async saveInput(callId, buf, ext) {
    const dir = path.join(LOCAL_BASE, callId);
    await fs.mkdir(dir, { recursive: true });
    const p = path.join(dir, `input.${ext}`);
    await fs.writeFile(p, buf);
    return p;
  },
  async saveTts(callId, buf) {
    const dir = path.join(LOCAL_BASE, callId);
    await fs.mkdir(dir, { recursive: true });
    const p = path.join(dir, 'tts.mp3');
    await fs.writeFile(p, buf);
    return p;
  },
  async read(callId, kind) {
    const dir = path.join(LOCAL_BASE, callId);
    try {
      if (kind === 'tts') {
        const buf = await fs.readFile(path.join(dir, 'tts.mp3'));
        return { buf, contentType: 'audio/mpeg' };
      }
      const files = await fs.readdir(dir);
      const inputFile = files.find((f) => f.startsWith('input.'));
      if (!inputFile) return null;
      const buf = await fs.readFile(path.join(dir, inputFile));
      const ext = inputFile.split('.').pop() ?? 'bin';
      const type =
        ext === 'mp3' ? 'audio/mpeg' :
        ext === 'wav' ? 'audio/wav' :
        ext === 'webm' ? 'audio/webm' :
        ext === 'ogg' ? 'audio/ogg' : 'application/octet-stream';
      return { buf, contentType: type };
    } catch {
      return null;
    }
  },
};

// ---------- S3-compatible driver (lazy-loaded so fs users don't need the dep) ----------
let s3DriverInstance: Driver | null = null;
async function s3Driver(): Promise<Driver> {
  if (s3DriverInstance) return s3DriverInstance;
  const bucket = process.env.STORAGE_S3_BUCKET;
  const region = process.env.STORAGE_S3_REGION ?? 'auto';
  const endpoint = process.env.STORAGE_S3_ENDPOINT;
  const accessKey = process.env.STORAGE_S3_ACCESS_KEY;
  const secretKey = process.env.STORAGE_S3_SECRET_KEY;
  if (!bucket || !accessKey || !secretKey) {
    throw new Error('STORAGE_DRIVER=s3 requires STORAGE_S3_BUCKET / STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY');
  }
  // dynamic import so the SDK is optional
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: !!endpoint, // needed for R2/MinIO
  });
  const put = async (key: string, buf: Buffer, contentType: string) => {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: contentType }));
    return `s3://${bucket}/${key}`;
  };
  const get = async (key: string): Promise<Buffer | null> => {
    try {
      const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const c of r.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  };
  s3DriverInstance = {
    async saveInput(callId, buf, ext) {
      const key = `audio/${callId}/input.${ext}`;
      const type = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : 'application/octet-stream';
      return put(key, buf, type);
    },
    async saveTts(callId, buf) {
      return put(`audio/${callId}/tts.mp3`, buf, 'audio/mpeg');
    },
    async read(callId, kind) {
      if (kind === 'tts') {
        const buf = await get(`audio/${callId}/tts.mp3`);
        return buf ? { buf, contentType: 'audio/mpeg' } : null;
      }
      for (const ext of ['mp3', 'wav', 'webm', 'ogg', 'bin']) {
        const buf = await get(`audio/${callId}/input.${ext}`);
        if (buf) {
          const type = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : 'application/octet-stream';
          return { buf, contentType: type };
        }
      }
      return null;
    },
  };
  return s3DriverInstance;
}

async function driver(): Promise<Driver> {
  if (DRIVER === 's3') return s3Driver();
  return fsDriver;
}

export async function saveInputAudio(callId: string, buf: Buffer, ext = 'bin'): Promise<string> {
  return (await driver()).saveInput(callId, buf, ext);
}

export async function saveTtsAudio(callId: string, buf: Buffer): Promise<string> {
  return (await driver()).saveTts(callId, buf);
}

export async function readAudio(callId: string, kind: 'input' | 'tts') {
  return (await driver()).read(callId, kind);
}

export function currentDriver() {
  return DRIVER;
}

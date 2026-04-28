import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import * as tus from 'tus-js-client';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const filePath = process.env.FILE_PATH;
const storagePath = process.env.STORAGE_PATH;

if (!supabaseUrl || !serviceKey || !filePath || !storagePath) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FILE_PATH, STORAGE_PATH');
  process.exit(1);
}

const projectId = new URL(supabaseUrl).hostname.split('.')[0];
const endpoint = `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;

const fileStat = await stat(filePath);
const fileName = path.basename(storagePath);

console.log(`Uploading: ${filePath}`);
console.log(`Size: ${(fileStat.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`Target: ${storagePath}`);
console.log(`Endpoint: ${endpoint}`);
console.log('');

await new Promise((resolve, reject) => {
  const stream = createReadStream(filePath);

  const upload = new tus.Upload(stream, {
    endpoint,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    uploadLengthDeferred: false,
    uploadSize: fileStat.size,
    headers: {
      authorization: `Bearer ${serviceKey}`,
      'x-upsert': 'true',
    },
    metadata: {
      bucketName: 'app-releases',
      objectName: storagePath,
      contentType: 'application/x-msdownload',
      cacheControl: '3600',
    },
    chunkSize: 6 * 1024 * 1024,
    onError(error) {
      console.error(`Upload failed: ${error.message}`);
      reject(error);
    },
    onProgress(bytesUploaded, bytesTotal) {
      const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
      const uploadedMB = (bytesUploaded / 1024 / 1024).toFixed(1);
      const totalMB = (bytesTotal / 1024 / 1024).toFixed(1);
      process.stdout.write(`\rProgress: ${pct}% (${uploadedMB} / ${totalMB} MB)`);
    },
    onSuccess() {
      console.log('\nUpload complete!');
      resolve();
    },
  });

  upload.start();
});

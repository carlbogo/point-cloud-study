import { readFile, writeFile } from 'node:fs/promises';
try {
  const source = await readFile('data/seed.sql', 'utf8');
  const lines = source
    .split(/\r?\n/)
    .filter((line) => !['BEGIN TRANSACTION;', 'COMMIT;'].includes(line.trim().toUpperCase()));
  await writeFile('data/seed-cloudflare.sql', lines.join('\n'));
  console.log('Prepared private data/seed-cloudflare.sql. No data has been uploaded.');
} catch (error) {
  console.error('Prepare or import images first: ' + error.message);
  process.exitCode = 1;
}

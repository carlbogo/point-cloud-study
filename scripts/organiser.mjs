import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

async function askToken() {
  if (!process.stdin.isTTY)
    throw new Error('Set CQ_ADMIN_TOKEN or add ADMIN_TOKEN to private .dev.vars.');
  process.stderr.write('ADMIN_TOKEN (hidden): ');
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return (await rl.question('')).trim();
  } finally {
    rl.close();
    process.stderr.write('\n');
  }
}
async function main() {
  const args = process.argv.slice(2),
    forcePrompt = args.includes('--prompt');
  const local = args.includes('--local');
  const [command, argument] = args.filter((a) => !['--prompt', '--local'].includes(a));
  if (!['invite', 'export', 'team-link'].includes(command))
    throw new Error(
      'Usage: node scripts/organiser.mjs team-link [--prompt] | invite study-2222-v4 [--prompt] | export /private/path/results.json',
    );
  let localConfig = {};
  if (local) {
    try {
      localConfig = JSON.parse(
        await readFile(new URL('../data/local-access.json', import.meta.url), 'utf8'),
      );
    } catch {}
  }
  const base = local
    ? process.env.CQ_LOCAL_URL || localConfig.base || 'http://localhost:8787'
    : process.env.STUDY_URL || 'https://constellation-study.constellation-study.workers.dev';
  let token = forcePrompt
    ? ''
    : local
      ? process.env.CQ_LOCAL_ADMIN_TOKEN
      : process.env.CQ_ADMIN_TOKEN;
  if (!token && !forcePrompt) {
    try {
      token = parseEnv(
        await readFile(
          new URL(local ? '../.dev.vars.local' : '../.dev.vars', import.meta.url),
          'utf8',
        ),
      ).ADMIN_TOKEN;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!token) token = await askToken();
  if (!token) throw new Error('No organiser key entered.');
  const call = async (path, body) => {
    let res;
    try {
      res = await fetch(new URL(path, base), {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new Error(`Cannot connect to ${base}: ${error.cause?.code || error.message}.`);
    }
    if (res.status === 401)
      throw new Error(
        'Organiser key does not match Cloudflare ADMIN_TOKEN. Retry with --prompt and enter the same key saved in Cloudflare.',
      );
    if (!res.ok) throw new Error(`Request failed (${res.status}): ${await res.text()}`);
    return res.json();
  };
  if (command === 'team-link') {
    console.log((await call('/api/admin/team-links', {})).url);
    return;
  }
  if (command === 'invite')
    console.log(
      (await call('/api/admin/invitations', { condition: argument || 'study-2222-v4' })).url,
    );
  else {
    let after = '',
      rows = [];
    do {
      const page = await call('/api/admin/export?after=' + encodeURIComponent(after));
      rows.push(...page.rows);
      after = page.next_cursor;
    } while (after);
    const file = argument || 'study-results.json';
    await writeFile(file, JSON.stringify(rows, null, 2));
    console.log(`Exported ${rows.length} answered trials to ${file}`);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

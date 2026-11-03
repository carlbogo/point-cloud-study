import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { parseArgs, parseEnv } from 'node:util';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    metadata: { type: 'string' },
    demo: { type: 'boolean', default: false },
    port: { type: 'string', default: '8787' },
  },
});
if ([values.dataset, values.metadata, values.demo].filter(Boolean).length > 1)
  throw new Error('Choose --dataset, --metadata, or --demo.');
if (!/^\d+$/.test(values.port) || +values.port < 1024 || +values.port > 65535)
  throw new Error('Invalid local port.');
function run(command, args, quiet = false) {
  const result = spawnSync(command, args, {
    stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (quiet) {
      process.stderr.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }
    process.exit(result.status || 1);
  }
}
const npmRun = (name, quiet = false) =>
  run(process.execPath, [process.env.npm_execpath, 'run', name], quiet);
const python = (...args) => run('python3', args);
if (values.dataset) python('scripts/import-study-data.py', values.dataset);
else if (values.metadata)
  python('scripts/import_notebook_dataset.py', '--metadata', values.metadata);
else if (values.demo) npmRun('prepare:demo');
else if (!existsSync('data/seed.sql')) {
  if (existsSync('data/study-dataset.zip'))
    python('scripts/import-study-data.py', 'data/study-dataset.zip');
  else {
    console.error('The full local study needs the private image collection.');
    console.error('Place study-dataset.zip in data/, or run:');
    console.error('npm run setup:local -- --dataset /path/to/study-dataset.zip');
    console.error('For a synthetic 7-image software demo only: npm run setup:demo');
    process.exit(1);
  }
} else console.log('Using the existing prepared study collection.');
mkdirSync('data', { recursive: true });
if (!values.demo) {
  const check = spawnSync(
    'python3',
    [
      '-c',
      `import sqlite3,pathlib,sys
c=sqlite3.connect(':memory:')
for p in sorted(pathlib.Path('migrations').glob('*.sql')): c.executescript(p.read_text())
c.executescript(pathlib.Path('data/seed.sql').read_text())
missing=[]
for dataset in ['mnist','fashion','cifar10']:
 for level,count in [(9,3),(11,2),(13,1),(17,1)]:
  available=c.execute('SELECT COUNT(DISTINCT source_index) FROM stimuli WHERE active=1 AND dataset=? AND difficulty=?',(dataset,level)).fetchone()[0]
  if available<count: missing.append(f'{dataset} d={level}')
if missing: sys.exit('Incomplete full-study collection: '+', '.join(missing)+'. Import the study ZIP, or choose npm run setup:demo explicitly.')
`,
    ],
    { stdio: 'inherit' },
  );
  if (check.status !== 0) process.exit(check.status || 1);
}
const varsFile = '.dev.vars.local';
let vars = existsSync(varsFile) ? readFileSync(varsFile, 'utf8') : '';
if (!parseEnv(vars).ADMIN_TOKEN) {
  vars += '\nADMIN_TOKEN=' + randomBytes(32).toString('hex') + '\n';
  writeFileSync(varsFile, vars);
  chmodSync(varsFile, 0o600);
}
for (const command of ['build', 'db:migrate', 'db:seed']) npmRun(command, command === 'db:seed');
const accessFile = 'data/local-access.json';
let saved = existsSync(accessFile) ? JSON.parse(readFileSync(accessFile, 'utf8')) : null;
const team = saved?.team || { id: randomUUID(), token: randomBytes(16).toString('hex') };
const respondent = { id: randomUUID(), token: randomBytes(16).toString('hex') };
const hash = (key) => createHash('sha256').update(key).digest('hex');
// Only hashes enter SQL / Wrangler logs. Credentials stay in ignored local files.
let sql = `INSERT INTO team_links(id,token_hash) VALUES('${team.id}','${hash(team.token)}') ON CONFLICT(id) DO NOTHING;\n`;
if (!values.demo)
  sql += `INSERT INTO invitations(id,token_hash,dataset,difficulty,plan_id,answer_mode) SELECT '${respondent.id}','${hash(respondent.token)}','mixed',0,'study-3211-v2',answer_mode FROM study_settings WHERE id=1;\n`;
writeFileSync('data/local-access.sql', sql);
run(
  process.execPath,
  [
    process.env.npm_execpath,
    'exec',
    '--',
    'wrangler',
    'd1',
    'execute',
    'constellation-study',
    '--local',
    '--env',
    'local',
    '--file',
    'data/local-access.sql',
    '--json',
  ],
  true,
);
writeFileSync(
  accessFile,
  JSON.stringify(
    { base: `http://localhost:${values.port}`, team, respondent: values.demo ? null : respondent },
    null,
    2,
  ),
);
chmodSync(accessFile, 0o600);
const base = `http://localhost:${values.port}`;
console.log('\nLocal study ready. Start the server:');
console.log(
  +values.port === 8787 ? 'npm run dev:api' : `npx wrangler dev --env local --port ${values.port}`,
);
console.log('\nTeam view: ' + base + '/team/' + team.token);
if (!values.demo) console.log('Respondent view (one run): ' + base + '/join/' + respondent.token);
console.log('Local organiser commands: node scripts/organiser.mjs team-link --local');
console.log('All setup and response data stay in the local D1 database.');

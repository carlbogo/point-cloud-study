// Run against a local `npm run dev:api`; never point this smoke test at production.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
let localAccess = {};
try {
  localAccess = JSON.parse(
    await readFile(new URL('../data/local-access.json', import.meta.url), 'utf8'),
  );
} catch {}
const base = process.env.CQ_TEST_URL || localAccess.base || 'http://localhost:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Smoke test is local-only.');
const token = crypto.randomUUID() + crypto.randomUUID();
const call = (path, body, method) =>
  fetch(base + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const config = await (await call('/api/config')).json();
assert.ok(config.conditions.some((condition) => condition.ready));
const condition =
  config.conditions.find((c) => c.id === 'study-3211-v2' && c.ready)?.id || 'mnist-preview-v1';
let state = await (
  await call('/api/runs', {
    condition,
    alias: 'HTTP smoke test',
    team_key: localAccess.team?.token,
  })
).json();
assert.ok(state.run_id);
const run = state.run_id,
  count = state.trial_count;
for (let n = 1; n <= count; n++) {
  assert.equal(state.trial.ordinal, n);
  assert.equal((await call(state.trial.image)).status, 200);
  assert.equal(
    (await call(`/api/runs/${run}/trials/${state.trial.id}/ready`, undefined, 'POST')).status,
    200,
  );
  const body = {
    submission_id: crypto.randomUUID(),
    answer: state.trial.options?.[0] || 'An object',
    response_time_ms: 1000,
    telemetry: {
      viewport_width: 1280,
      viewport_height: 720,
      events: [
        { type: 'stimulus_ready', t: 0 },
        { type: 'answer_submitted', t: 1000 },
      ],
    },
  };
  const response = await call(`/api/runs/${run}/trials/${state.trial.id}/answer`, body);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).correct_answer);
  state = await (await call('/api/runs/' + run)).json();
}
assert.equal(state.complete, true);
const results = await (await call(`/api/runs/${run}/results`)).json();
assert.equal(results.rows.length, count);
for (const path of ['/stimuli/manifest.json', '/%73timuli/manifest.json', '/data/seed.sql'])
  assert.equal((await call(path)).status, 404);
if (count === 21)
  for (const dataset of ['mnist', 'fashion', 'cifar10'])
    assert.deepEqual(
      [9, 11, 13, 17].map(
        (d) => results.rows.filter((r) => r.dataset === dataset && r.difficulty === d).length,
      ),
      [3, 2, 1, 1],
    );
console.log(
  `Real Worker + local D1: ${count}-trial run, four-level quotas, images, feedback, results and private-file checks passed.`,
);

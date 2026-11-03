import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { type Env } from '../worker/index.ts';
import { grade, options } from '../worker/grading.ts';
import { digest } from '../worker/access.ts';
import { summarise } from '../worker/telemetry.ts';
import { samplePlan, plans, DIFFICULTIES, type Stimulus } from '../worker/sampling.ts';

// Real SQLite exercises the migration, conditional writes and uniqueness constraints.
function setup(publicRuns = 'false') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0002_study_plans.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0003_stimulus_metadata.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0004_skipped_answers.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0005_modes_and_team.sql', 'utf8'));
  for (const dataset of ['mnist', 'fashion', 'cifar10'])
    for (const difficulty of DIFFICULTIES)
      for (let i = 0; i < 12; i++) {
        sqlite
          .prepare(
            'INSERT INTO stimuli(id,image_path,dataset,difficulty,label,source_index,stimulus_source) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            `${dataset}-${difficulty}-${i}`,
            `/stimuli/test-${dataset}-${difficulty}-${i}.png`,
            dataset,
            difficulty,
            options[dataset][i % options[dataset].length],
            `fixture-${i}`,
            'test-fixture',
          );
      }
  class Statement {
    values: any[] = [];
    constructor(public sql: string) {}
    bind(...values: any[]) {
      this.values = values;
      return this;
    }
    async first() {
      return sqlite.prepare(this.sql).get(...this.values) ?? null;
    }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...this.values) };
    }
    async run() {
      return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } };
    }
  }
  const env = {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      batch: async (statements: Statement[]) => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (e) {
          sqlite.exec('ROLLBACK');
          throw e;
        }
      },
    },
    ADMIN_TOKEN: 'organiser-test-token-12345678901234567890',
    ALLOW_PUBLIC_RUNS: publicRuns,
    DATA_ENV: 'test',
    ASSETS: {
      fetch: async (req: Request) => {
        const p = new URL(req.url).pathname;
        if (p.startsWith('/stimuli/test-'))
          return new Response('test-image', { headers: { 'Content-Type': 'image/png' } });
        try {
          return new Response(readFileSync('dist' + p), {
            headers: { 'Content-Type': 'image/png' },
          });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      },
    },
  } as unknown as Env;
  const request = async (path: string, token?: string, body?: unknown, method?: string) => {
    const req = new Request('https://study.test' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return worker.fetch(req, env);
  };
  return { sqlite, env, request };
}
const linkToken = (value: string) => {
  const url = new URL(value);
  return url.pathname.split('/').filter(Boolean).at(-1)!;
};
const secret = () => crypto.randomUUID() + crypto.randomUUID();
const submission = (answer = '1') => ({
  submission_id: crypto.randomUUID(),
  answer,
  response_time_ms: 1200,
  telemetry: {
    viewport_width: 1280,
    viewport_height: 720,
    events: [
      { type: 'stimulus_ready', t: 0 },
      { type: 'answer_changed', t: 800, answer },
      { type: 'answer_submitted', t: 1200 },
    ],
  },
});

test('full plan has 21 images with 3–2–1–1 per dataset and no repeated originals', () => {
  const pool = plans[0].datasets.flatMap((dataset) =>
    DIFFICULTIES.flatMap((difficulty) =>
      Array.from(
        { length: 12 },
        (_, i) =>
          ({
            id: `${dataset}-${difficulty}-${i}`,
            dataset,
            difficulty,
            label: String((i % 9) + 1),
            source_index: String(i),
            exposures: i < 9 ? 0 : 10,
          }) as Stimulus,
      ),
    ),
  );
  for (let n = 0; n < 40; n++) {
    const chosen = samplePlan(pool, plans[0]);
    assert.equal(chosen.length, 21);
    assert.ok(chosen.slice(0, 3).every((s) => s.dataset === 'mnist' && s.difficulty === 9));
    assert.ok(chosen.slice(3).every((s) => s.dataset !== 'mnist' || s.difficulty !== 9));
    for (let i = 1; i < chosen.length; i++)
      assert.ok(chosen[i].difficulty >= chosen[i - 1].difficulty);
    assert.deepEqual(
      DIFFICULTIES.map((d) => chosen.filter((s) => s.difficulty === d).length),
      [9, 6, 3, 3],
    );
    for (const dataset of plans[0].datasets) {
      const items = chosen.filter((s) => s.dataset === dataset);
      assert.equal(items.length, 7);
      assert.equal(new Set(items.map((s) => s.source_index)).size, 7);
      assert.deepEqual(
        DIFFICULTIES.map((d) => items.filter((s) => s.difficulty === d).length),
        [3, 2, 1, 1],
      );
    }
  }
  assert.throws(() =>
    samplePlan(
      pool.filter((s) => s.dataset !== 'fashion'),
      plans[0],
    ),
  );
});

test('private sessions: no answer leaks; one-use invitation; retries do not rewrite answers; mixed-dataset run export', async () => {
  const { sqlite, env, request } = setup();
  assert.equal((await request('/api/admin/export')).status, 401);
  assert.equal((await request('/api/runs', secret(), { condition: 'study-3211-v2' })).status, 403);
  const invitation = (await (
    await request('/api/admin/invitations', env.ADMIN_TOKEN, { condition: 'study-3211-v2' })
  ).json()) as any;
  const invite = linkToken(invitation.url);
  const token = secret();
  const response = await request('/api/runs', token, {
    invite,
    alias: '=spreadsheet',
    participant_kind: 'model',
  });
  assert.equal(response.status, 201);
  let state = (await response.json()) as any;
  const runId = state.run_id;
  const first = state.trial.id;
  assert.equal((await request('/api/runs/' + runId, secret())).status, 404);
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM trials WHERE run_id=?').get(runId) as any;
  assert.equal(count.n, 21);
  assert.deepEqual(Object.keys(state.trial).sort(), [
    'answer_type',
    'id',
    'image',
    'options',
    'ordinal',
  ]);
  assert.ok(!JSON.stringify(state).includes('label'));
  assert.equal((await request('/api/runs', secret(), { invite })).status, 409);
  assert.equal((await request('/api/runs', token, { invite })).status, 200);
  assert.equal((await request(`/api/runs/${runId}/results`, token)).status, 409);
  const raw = sqlite
    .prepare('SELECT s.image_path FROM trials t JOIN stimuli s ON s.id=t.stimulus_id WHERE t.id=?')
    .get(first) as any;
  for (const path of [
    '/stimuli/manifest.json',
    raw.image_path,
    '/api/admin/export',
    '/data/seed.sql',
  ]) {
    const res = await request(path);
    assert.ok(res.status >= 400, `${path} must not be public`);
  }
  assert.equal((await request(state.trial.image)).status, 401);
  assert.equal((await request(state.trial.image, token)).status, 200);
  const later = sqlite
    .prepare('SELECT id FROM trials WHERE run_id=? AND ordinal=2')
    .get(runId) as any;
  assert.equal(
    (await request(`/api/runs/${runId}/trials/${later.id}/ready`, token, {}, 'POST')).status,
    409,
  );
  let previousDifficulty = 0;
  for (let ordinal = 1; ordinal <= 21; ordinal++) {
    assert.equal(state.trial.ordinal, ordinal);
    assert.ok(state.difficulty >= previousDifficulty);
    previousDifficulty = state.difficulty;
    if (ordinal <= 3) {
      assert.equal(state.dataset, 'mnist');
      assert.equal(state.difficulty, 9);
    }
    const endpoint = `/api/runs/${runId}/trials/${state.trial.id}`;
    const body = submission(
      state.trial.answer_type === 'text' ? 'An unknown shape' : state.trial.options[0],
    );
    if (ordinal === 1) assert.equal((await request(endpoint + '/answer', token, body)).status, 409);
    assert.equal((await request(endpoint + '/ready', token, {}, 'POST')).status, 200);
    if (ordinal === 1) {
      const invalid = submission();
      invalid.telemetry.events[1].t = 1300;
      assert.equal((await request(endpoint + '/answer', token, invalid)).status, 400);
      if (state.dataset === 'mnist')
        assert.equal(
          (await request(endpoint + '/answer', token, { ...body, answer: '0' })).status,
          400,
        );
    }
    const saved = await request(endpoint + '/answer', token, body);
    assert.equal(saved.status, 200);
    const feedback = (await saved.json()) as any;
    assert.ok(feedback.correct_answer);
    if (state.trial.answer_type === 'text') assert.equal(feedback.correct, null);
    const replay = await request(endpoint + '/answer', token, body);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), feedback);
    assert.equal(
      (await request(endpoint + '/answer', token, { ...body, answer: '2' })).status,
      409,
    );
    if (ordinal === 1) assert.equal((await request(state.trial.image, token)).status, 403);
    state = await (await request('/api/runs/' + runId, token)).json();
  }
  assert.equal(state.complete, true);
  assert.equal((await request(`/api/runs/${runId}/storage`)).status, 401);
  assert.equal((await request(`/api/runs/${runId}/storage`, secret())).status, 404);
  const receipt = (await (await request(`/api/runs/${runId}/storage`, token)).json()) as any;
  assert.equal(receipt.saved_count, 21);
  assert.equal(receipt.expected_count, 21);
  assert.equal(receipt.complete, true);
  assert.ok(receipt.last_saved_at);
  assert.equal(receipt.run_id, runId);
  assert.equal(receipt.environment, 'test');
  const results = (await (await request(`/api/runs/${runId}/results`, token)).json()) as any;
  assert.equal(results.rows.length, 21);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM answers').get() as any).n, 21);
  const exported = (await (await request('/api/admin/export', env.ADMIN_TOKEN)).json()) as any;
  assert.equal(exported.rows.length, 21);
  assert.ok(exported.rows[0].telemetry.events.length);
  assert.ok(exported.rows[0].ground_truth);
  assert.deepEqual(
    new Set(exported.rows.map((r: any) => r.dataset)),
    new Set(['mnist', 'fashion', 'cifar10']),
  );
  const csv = await (await request('/api/admin/export?format=csv', env.ADMIN_TOKEN)).text();
  assert.ok(csv.includes("'=spreadsheet"));
  sqlite.close();
});

test('simultaneous submissions keep the first committed answer; malformed telemetry is rejected', async () => {
  const { sqlite, request } = setup('true');
  const token = secret();
  const state = (await (
    await request('/api/runs', token, { condition: 'mnist-preview-v1' })
  ).json()) as any;
  const path = `/api/runs/${state.run_id}/trials/${state.trial.id}`;
  await request(path + '/ready', token, {}, 'POST');
  const invalid = submission();
  (invalid.telemetry.events[1] as any).x = 2;
  assert.equal((await request(path + '/answer', token, invalid)).status, 400);
  const responses = await Promise.all([
    request(path + '/answer', token, submission('1')),
    request(path + '/answer', token, submission('2')),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM answers').get() as any).n, 1);
  sqlite.close();
});

test('telemetry separates drawing, hidden time and first action', () => {
  const summary = summarise(
    [
      { type: 'stimulus_ready', t: 0 },
      { type: 'visibility_changed', t: 0, hidden: false },
      { type: 'stroke_start', t: 100, id: 'a', x: 0, y: 0 },
      { type: 'stroke_end', t: 400, id: 'a', x: 1, y: 0 },
      { type: 'undo', t: 500 },
      { type: 'visibility_changed', t: 600, hidden: true },
      { type: 'visibility_changed', t: 900, hidden: false },
      { type: 'answer_changed', t: 1000 },
    ],
    1200,
  );
  assert.equal(summary.first_action_ms, 100);
  assert.equal(summary.drawing_time_ms, 300);
  assert.equal(summary.hidden_time_ms, 300);
  assert.equal(summary.visible_time_ms, 900);
  assert.equal(summary.drawing_length_normalised, 1);
  assert.equal(summary.undo_count, 1);
});

test('sampling handles overlapping source pools without random readiness failures', () => {
  const plan = { ...plans[1], counts: [1, 1, 1, 1] };
  const pool = [
    { difficulty: 9, source_index: 'a' },
    { difficulty: 9, source_index: 'b' },
    { difficulty: 11, source_index: 'a' },
    { difficulty: 13, source_index: 'c' },
    { difficulty: 17, source_index: 'd' },
  ].map((s, i) => ({ ...s, dataset: 'mnist', label: '1', id: String(i) }) as Stimulus);
  for (let n = 0; n < 30; n++)
    assert.equal(new Set(samplePlan(pool, plan).map((s) => s.source_index)).size, 4);
});

test('organiser authentication accepts the configured key independently of session token format', async () => {
  const { sqlite, env, request } = setup();
  env.ADMIN_TOKEN = 'Key!234?';
  assert.equal((await request('/api/admin/export', env.ADMIN_TOKEN)).status, 200);
  assert.equal((await request('/api/admin/export', 'wrong-key')).status, 401);
  sqlite.close();
});

test('skip reveals the answer, is idempotent, advances and cannot be replaced', async () => {
  const { sqlite, request } = setup('true');
  const token = secret();
  const state = (await (
    await request('/api/runs', token, { condition: 'mnist-preview-v1' })
  ).json()) as any;
  const path = `/api/runs/${state.run_id}/trials/${state.trial.id}`;
  await request(path + '/ready', token, {}, 'POST');
  const body = { ...submission(''), skipped: true };
  body.telemetry.events = [
    { type: 'stimulus_ready', t: 0 },
    { type: 'trial_skipped', t: 1200 },
  ];
  const response = await request(path + '/answer', token, body);
  assert.equal(response.status, 200);
  const feedback = (await response.json()) as any;
  assert.equal(feedback.skipped, 1);
  assert.equal(feedback.correct, null);
  assert.ok(feedback.correct_answer);
  assert.equal((await request(path + '/answer', token, body)).status, 200);
  assert.equal(
    (await request(path + '/answer', token, { ...body, skipped: false, answer: '1' })).status,
    409,
  );
  const next = (await (await request('/api/runs/' + state.run_id, token)).json()) as any;
  assert.equal(next.trial.ordinal, 2);
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM answers').get() as any).n, 1);
  sqlite.close();
});

test('synonyms accept spelling, plurals and common alternatives without conflating categories', () => {
  for (const [label, answer] of [
    ['Sneaker', 'shoe'],
    ['Sneaker', 'TRAINERS'],
    ['Trouser', 'pants'],
    ['Trouser', 'the trousers'],
    ['T-shirt top', 'a t-shirt'],
    ['Ankle boot', 'boots'],
  ])
    assert.equal(grade('fashion', label, answer, 'legacy').correct, 1);
  assert.equal(grade('cifar10', 'airplane', 'aeroplane', 'hybrid').correct, 1);
  assert.equal(grade('cifar10', 'automobile', 'a car', 'hybrid').correct, 1);
  assert.equal(grade('fashion', 'Shirt', 't-shirt', 'legacy').correct, null);
  assert.equal(grade('cifar10', 'automobile', 'ankle boot', 'hybrid').correct, null);
  assert.equal(grade('cifar10', 'cat', 'dog', 'choices').correct, 0);
  assert.equal(grade('cifar10', 'cat', '', 'hybrid', true).method, 'skipped');
});

test('team controls are authenticated; respondent modes are frozen; team test data is marked', async () => {
  const { sqlite, env, request } = setup();
  const teamResponse = await request('/api/admin/team-links', env.ADMIN_TOKEN, {});
  assert.equal(teamResponse.status, 201);
  const teamLink = (await teamResponse.json()) as any;
  const team = linkToken(teamLink.url);
  assert.equal((await request('/api/team/settings')).status, 401);
  assert.equal(
    (await request('/api/team/settings', secret(), { answer_mode: 'choices' })).status,
    401,
  );
  const access = (await (
    await request('/api/access', undefined, { team_key: team })
  ).json()) as any;
  assert.equal(access.role, 'team');
  assert.equal((await request('/api/admin/export', team)).status, 401);
  assert.equal((await request('/api/admin/team-links', team, {})).status, 401);
  const link = (await (await request('/api/team/invitations', team, {})).json()) as any;
  const invite = linkToken(link.url);
  assert.equal(link.answer_mode, 'hybrid');
  assert.equal(
    (await request('/api/team/settings', invite, { answer_mode: 'choices' })).status,
    401,
  );
  assert.equal(
    (await request('/api/runs', secret(), { invite, answer_mode: 'choices' })).status,
    403,
  );
  assert.equal(
    (await request('/api/runs', secret(), { team_key: 'invalid', condition: 'study-3211-v2' }))
      .status,
    403,
  );
  assert.equal((await request('/api/team/settings', team, { answer_mode: 'choices' })).status, 200);
  const token = secret();
  const state = (await (await request('/api/runs', token, { invite })).json()) as any;
  assert.equal(state.answer_mode, 'hybrid');
  assert.equal(state.audience, 'respondent');
  assert.equal((await request('/api/team/invitations', token, {})).status, 401);
  const respondentAccess = (await (
    await request('/api/access', undefined, { invite })
  ).json()) as any;
  assert.equal(respondentAccess.answer_mode, 'hybrid');
  const teamToken = secret();
  let testRun = (await (
    await request('/api/runs', teamToken, { team_key: team, condition: 'study-3211-v2' })
  ).json()) as any;
  assert.equal(testRun.answer_mode, 'choices');
  assert.equal(testRun.audience, 'team');
  // Changing the global mode cannot alter this run's snapshot.
  await request('/api/team/settings', team, { answer_mode: 'hybrid' });
  testRun = await (await request('/api/runs/' + testRun.run_id, teamToken)).json();
  assert.equal(testRun.answer_mode, 'choices');
  for (let n = 0; n < 21; n++) {
    assert.notEqual(testRun.trial.answer_type, 'text');
    assert.ok(testRun.trial.options.length >= 9);
    const base = `/api/runs/${testRun.run_id}/trials/${testRun.trial.id}`;
    await request(base + '/ready', teamToken, {}, 'POST');
    const answer = testRun.trial.options[0];
    const res = await request(base + '/answer', teamToken, submission(answer));
    assert.equal(res.status, 200);
    testRun = await (await request('/api/runs/' + testRun.run_id, teamToken)).json();
  }
  assert.equal(testRun.complete, true);
  assert.equal(testRun.trial, undefined);
  const results = (await (
    await request('/api/runs/' + testRun.run_id + '/results', teamToken)
  ).json()) as any;
  assert.equal(results.rows.length, 21);
  assert.ok(results.rows.every((r: any) => r.correct !== null));
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM answers').get() as any).n, 21);
  sqlite.close();
});

test('shared entry URLs load without consuming an invitation; used status is explicit', async () => {
  const { sqlite, env, request } = setup();
  const response = await request('/api/admin/invitations', env.ADMIN_TOKEN, {
    condition: 'study-3211-v2',
  });
  const link = (await response.json()) as any;
  const invite = linkToken(link.url);
  assert.equal(invite.length, 32);
  assert.match(new URL(link.url).pathname, /^\/join\//);
  for (let n = 0; n < 3; n++) {
    const page = await request(new URL(link.url).pathname);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
  }
  assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM runs').get() as any).n, 0);
  let status = (await (await request('/api/access', undefined, { invite })).json()) as any;
  assert.equal(status.used, 0);
  const token = secret();
  assert.equal((await request('/api/runs', token, { invite })).status, 201);
  status = (await (await request('/api/access', undefined, { invite })).json()) as any;
  assert.equal(status.used, 1);
  const duplicate = await request('/api/runs', secret(), { invite });
  assert.equal(duplicate.status, 409);
  assert.match(((await duplicate.json()) as any).error, /another browser/);
  assert.equal((await request('/api/runs', token, { invite })).status, 200);
  const old = secret();
  await sqlite
    .prepare(
      'INSERT INTO invitations(id,token_hash,dataset,difficulty,plan_id,answer_mode) VALUES(?,?,?,?,?,?)',
    )
    .run('legacy-link', await digest(old), 'mixed', 0, 'study-3211-v2', 'hybrid');
  assert.equal((await request('/api/access', undefined, { invite: old })).status, 200);
  sqlite.close();
});

test('local study uses team and respondent access with the same full plan as production', async () => {
  const { sqlite, env, request } = setup();
  env.DATA_ENV = 'local';
  const config = (await (await request('/api/config')).json()) as any;
  assert.deepEqual(
    config.conditions.map((condition: any) => condition.id),
    ['study-3211-v2'],
  );
  assert.equal((await request('/api/runs', secret(), { condition: 'study-3211-v2' })).status, 403);
  const link = (await (await request('/api/admin/team-links', env.ADMIN_TOKEN, {})).json()) as any;
  const key = linkToken(link.url);
  const full = (await (
    await request('/api/runs', secret(), { team_key: key, condition: 'study-3211-v2' })
  ).json()) as any;
  assert.equal(full.trial_count, 21);
  assert.equal(full.audience, 'team');
  assert.equal(full.answer_mode, 'hybrid');
  const preview = await request('/api/runs', secret(), {
    team_key: key,
    condition: 'mnist-preview-v1',
  });
  assert.equal(preview.status, 201);
  env.DATA_ENV = 'production';
  assert.equal(
    (await request('/api/runs', secret(), { team_key: key, condition: 'mnist-preview-v1' })).status,
    400,
  );
  sqlite.close();
});

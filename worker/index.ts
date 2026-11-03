import { plans, samplePlan, trialCount, DIFFICULTIES, type Stimulus } from './sampling';
import { object, text, finite, telemetry } from './validation';
import { summarise } from './telemetry';
import { answerType, options, grade, type AnswerMode } from './grading';
import { isTeam, settings } from './access';
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
  ALLOW_PUBLIC_RUNS?: string;
  DATA_ENV?: string;
}
type Run = {
  id: string;
  dataset: string;
  difficulty: number;
  trial_count: number;
  plan_id?: string | null;
  answer_mode: AnswerMode;
  audience: string;
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
const token = () => crypto.randomUUID().replaceAll('-', '');
function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
async function body(req: Request) {
  if (!req.headers.get('content-type')?.includes('application/json'))
    fail(415, 'Use application/json.');
  const reader = req.body?.getReader();
  if (!reader) fail(400, 'Missing request body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader!.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512000) {
      await reader!.cancel();
      fail(413, 'Request too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return fail(400, 'Invalid JSON body.');
  }
}
const bearer = (req: Request) =>
  req.headers.get('Authorization')?.match(/^Bearer ([a-zA-Z0-9-]{32,100})$/)?.[1] ?? '';
async function admin(req: Request, env: Env) {
  const supplied =
    req.headers.get('Authorization')?.match(/^Bearer ([\x21-\x7e]{1,512})$/)?.[1] ?? '';
  if (!env.ADMIN_TOKEN || !supplied) fail(401, 'Organiser authentication required.');
  const a = await hash(supplied),
    b = await hash(env.ADMIN_TOKEN!);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff) fail(401, 'Organiser authentication required.');
}
async function management(req: Request, env: Env) {
  if (await isTeam(env.DB, bearer(req))) return;
  await admin(req, env);
}
async function createInvitation(env: Env, origin: string, condition: unknown) {
  const c = plans.find((c) => c.id === (condition ?? 'study-3211-v2') && !c.demoOnly);
  if (!c) fail(400, 'Unknown condition.');
  const mode = (await settings(env.DB)).answer_mode,
    secret = token();
  await env.DB.prepare(
    'INSERT INTO invitations(id,token_hash,dataset,difficulty,plan_id,answer_mode) VALUES(?,?,?,?,?,?)',
  )
    .bind(crypto.randomUUID(), await hash(secret), c!.dataset, c!.difficulty, c!.id, mode)
    .run();
  return { url: `${origin}/join/${secret}`, condition: c!.id, answer_mode: mode };
}
async function runFor(req: Request, env: Env, id: string): Promise<Run> {
  const secret = bearer(req);
  if (!secret) fail(401, 'Session authentication required.');
  const run = await env.DB.prepare(
    'SELECT id,dataset,difficulty,trial_count,plan_id,answer_mode,audience FROM runs WHERE id=? AND token_hash=?',
  )
    .bind(id, await hash(secret))
    .first<Run>();
  return run ?? fail(404, 'Session not found.');
}
async function current(env: Env, run: Run) {
  return env.DB.prepare(
    `SELECT t.id,t.ordinal,t.stimulus_id,t.ready_at,s.dataset,s.difficulty FROM trials t
    JOIN stimuli s ON s.id=t.stimulus_id LEFT JOIN answers a ON a.trial_id=t.id WHERE t.run_id=? AND a.trial_id IS NULL ORDER BY t.ordinal LIMIT 1`,
  )
    .bind(run.id)
    .first<{
      id: string;
      ordinal: number;
      stimulus_id: string;
      ready_at: string | null;
      dataset: string;
      difficulty: number;
    }>();
}
async function state(env: Env, run: Run) {
  const trial = await current(env, run);
  if (!trial)
    return {
      run_id: run.id,
      complete: true,
      trial_count: run.trial_count,
      answer_mode: run.answer_mode,
      audience: run.audience,
    };
  await env.DB.prepare('UPDATE trials SET served_at=COALESCE(served_at,?) WHERE id=?')
    .bind(new Date().toISOString(), trial.id)
    .run();
  return {
    run_id: run.id,
    complete: false,
    trial_count: run.trial_count,
    dataset: trial.dataset,
    difficulty: trial.difficulty,
    plan_id: run.plan_id,
    answer_mode: run.answer_mode,
    audience: run.audience,
    trial: {
      id: trial.id,
      ordinal: trial.ordinal,
      answer_type: answerType(trial.dataset, run.answer_mode),
      options:
        answerType(trial.dataset, run.answer_mode) === 'text' ? [] : (options[trial.dataset] ?? []),
      image: `/api/runs/${run.id}/image/${trial.id}`,
    },
  };
}
async function feedback(env: Env, trialId: string) {
  return env.DB.prepare(
    `SELECT a.answer,a.skipped,a.correct,a.grading_method,s.label AS correct_answer,a.response_time_ms,a.submitted_at
    FROM answers a JOIN trials t ON t.id=a.trial_id JOIN stimuli s ON s.id=t.stimulus_id WHERE a.trial_id=?`,
  )
    .bind(trialId)
    .first();
}
const quote = (value: unknown) => {
  let s = String(value ?? '');
  if (/^[=+@\-\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url),
    path = url.pathname;
  if (req.method !== 'GET' && req.headers.get('Origin') && req.headers.get('Origin') !== url.origin)
    fail(403, 'Cross-origin request blocked.');
  if (path === '/api/config' && req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM stimuli WHERE active=1',
    ).all<Stimulus>();
    const available = plans
      .filter((p) => !p.demoOnly || env.DATA_ENV === 'local' || env.ALLOW_PUBLIC_RUNS === 'true')
      .map((p) => {
        let reason: string | null = null;
        try {
          samplePlan(results, p);
        } catch (e) {
          reason = (e as Error).message;
        }
        return {
          id: p.id,
          name: p.name,
          trial_count: trialCount(p),
          datasets: p.datasets,
          counts: p.counts,
          difficulties: DIFFICULTIES,
          ready: reason === null,
          unavailable_reason: reason,
          preview: Boolean(p.demoOnly),
          demo: results.some(
            (s) => p.datasets.includes(s.dataset) && s.stimulus_source === 'demo-glyphs',
          ),
        };
      });
    return json({
      conditions: available.some((condition) => !condition.preview && condition.ready)
        ? available.filter((condition) => !condition.preview)
        : available,
      trial_count: 21,
      public_runs: env.ALLOW_PUBLIC_RUNS === 'true',
    });
  }
  if (path === '/api/access' && req.method === 'POST') {
    const data = await body(req);
    if (await isTeam(env.DB, data.team_key))
      return json({ role: 'team', ...(await settings(env.DB)) });
    if (typeof data.invite === 'string') {
      const invite = await env.DB.prepare(
        'SELECT i.answer_mode,i.plan_id,EXISTS(SELECT 1 FROM runs r WHERE r.invitation_id=i.id) AS used FROM invitations i WHERE i.token_hash=?',
      )
        .bind(await hash(data.invite))
        .first();
      if (invite) return json({ role: 'respondent', ...invite });
    }
    fail(403, 'This invitation or team link is invalid.');
  }
  if (path === '/api/admin/team-links' && req.method === 'POST') {
    await admin(req, env);
    const secret = token();
    await env.DB.prepare('INSERT INTO team_links(id,token_hash) VALUES(?,?)')
      .bind(crypto.randomUUID(), await hash(secret))
      .run();
    return json({ url: `${url.origin}/team/${secret}` }, 201);
  }
  if (path === '/api/team/settings') {
    await management(req, env);
    if (req.method === 'GET') return json(await settings(env.DB));
    if (req.method === 'POST') {
      const data = await body(req);
      if (!['hybrid', 'choices'].includes(data.answer_mode)) fail(400, 'Unknown answer mode.');
      await env.DB.prepare('UPDATE study_settings SET answer_mode=?,updated_at=? WHERE id=1')
        .bind(data.answer_mode, new Date().toISOString())
        .run();
      return json(await settings(env.DB));
    }
  }
  if (
    (path === '/api/admin/invitations' || path === '/api/team/invitations') &&
    req.method === 'POST'
  ) {
    if (path.startsWith('/api/admin/')) await admin(req, env);
    else await management(req, env);
    return json(await createInvitation(env, url.origin, (await body(req)).condition), 201);
  }
  if (path === '/api/admin/export' && req.method === 'GET') {
    await admin(req, env);
    const after = url.searchParams.get('after') ?? '';
    const { results } = await env.DB.prepare(
      `SELECT t.id AS trial_id,r.id AS run_id,r.alias,r.participant_kind,r.plan_id,r.answer_mode,r.audience,s.dataset,s.difficulty,
      t.ordinal,s.id AS stimulus_id,s.source_index,s.stimulus_source,s.label AS ground_truth,s.metadata_json,
      t.served_at,t.ready_at,a.answer,a.skipped,a.correct,a.grading_method,a.response_time_ms,a.submitted_at,a.telemetry_json
      FROM answers a JOIN trials t ON t.id=a.trial_id JOIN runs r ON r.id=t.run_id JOIN stimuli s ON s.id=t.stimulus_id
      WHERE t.id>? ORDER BY t.id LIMIT 1000`,
    )
      .bind(after)
      .all<Record<string, unknown>>();
    const next = results.length === 1000 ? String(results.at(-1)!.trial_id) : null;
    if (url.searchParams.get('format') === 'csv') {
      const rows = results.map(({ telemetry_json, ...row }) => ({
        ...row,
        ...JSON.parse(String(telemetry_json)).summary,
      }));
      const cols = Object.keys(rows[0] ?? {});
      return new Response(
        [
          cols.map(quote).join(','),
          ...rows.map((row) => cols.map((c) => quote(row[c])).join(',')),
        ].join('\r\n'),
        {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="trials.csv"',
            'Cache-Control': 'no-store',
            ...(next ? { 'X-Next-Cursor': next } : {}),
          },
        },
      );
    }
    return json({
      rows: results.map(({ telemetry_json, ...row }) => ({
        ...row,
        telemetry: JSON.parse(String(telemetry_json)),
      })),
      next_cursor: next,
    });
  }
  if (path === '/api/runs' && req.method === 'POST') {
    const secret = bearer(req);
    if (!secret) fail(401, 'Provide a random session token.');
    const data = await body(req),
      tokenHash = await hash(secret);
    const existing = await env.DB.prepare(
      'SELECT id,dataset,difficulty,trial_count,plan_id,answer_mode,audience FROM runs WHERE token_hash=?',
    )
      .bind(tokenHash)
      .first<Run>();
    if (existing) return json(await state(env, existing));
    const invite =
      typeof data.invite === 'string'
        ? await env.DB.prepare('SELECT * FROM invitations WHERE token_hash=?')
            .bind(await hash(data.invite))
            .first<{
              id: string;
              dataset: string;
              difficulty: number;
              plan_id: string | null;
              answer_mode: AnswerMode;
            }>()
        : null;
    const team = await isTeam(env.DB, data.team_key);
    if (data.team_key && !team) fail(403, 'Invalid team link.');
    if (data.answer_mode !== undefined) fail(403, 'Answer mode is set by the organiser.');
    if (data.invite && !invite) fail(403, 'Invitation is invalid.');
    if (!invite && !team && env.ALLOW_PUBLIC_RUNS !== 'true')
      fail(403, 'An invitation is required.');
    const c = plans.find((c) => c.id === (invite ? invite.plan_id : data.condition));
    const demoAllowed = env.DATA_ENV === 'local' || env.ALLOW_PUBLIC_RUNS === 'true';
    if (!c || (c.demoOnly && (!demoAllowed || invite))) fail(400, 'Unknown study plan.');
    const mode = invite?.answer_mode ?? (await settings(env.DB)).answer_mode;
    const audience = team ? 'team' : 'respondent';
    const alias = text(data.alias ?? '', 30);
    const kind = data.participant_kind ?? 'human';
    if (!['human', 'model'].includes(kind)) fail(400, 'Invalid participant kind.');
    const { results } = await env.DB.prepare(
      `SELECT s.*,COUNT(t.id) AS exposures FROM stimuli s LEFT JOIN trials t ON t.stimulus_id=s.id
      WHERE s.active=1 GROUP BY s.id`,
    ).all<Stimulus>();
    let selected: Stimulus[];
    try {
      selected = samplePlan(results, c!);
    } catch (e) {
      return fail(409, (e as Error).message);
    }
    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO runs(id,token_hash,invitation_id,dataset,difficulty,alias,participant_kind,trial_count,plan_id,answer_mode,audience) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          id,
          tokenHash,
          invite?.id ?? null,
          c!.dataset,
          c!.difficulty,
          alias,
          kind,
          trialCount(c!),
          c!.id,
          mode,
          audience,
        ),
        ...selected.map((s, i) =>
          env.DB.prepare('INSERT INTO trials(id,run_id,ordinal,stimulus_id) VALUES(?,?,?,?)').bind(
            crypto.randomUUID(),
            id,
            i + 1,
            s.id,
          ),
        ),
      ]);
    } catch (error) {
      const retried = await env.DB.prepare(
        'SELECT id,dataset,difficulty,trial_count,plan_id,answer_mode,audience FROM runs WHERE token_hash=?',
      )
        .bind(tokenHash)
        .first<Run>();
      if (retried) return json(await state(env, retried));
      if (
        invite &&
        (await env.DB.prepare('SELECT id FROM runs WHERE invitation_id=?').bind(invite.id).first())
      )
        fail(
          409,
          'This invitation has already been started in another browser. Resume there, or ask the organiser for a new link.',
        );
      throw error;
    }
    return json(
      await state(env, {
        id,
        dataset: c!.dataset,
        difficulty: c!.difficulty,
        trial_count: trialCount(c!),
        plan_id: c!.id,
        answer_mode: mode,
        audience,
      }),
      201,
    );
  }
  const match = path.match(/^\/api\/runs\/([a-f0-9-]+)(?:\/(.*))?$/);
  if (match) {
    const run = await runFor(req, env, match[1]),
      action = match[2] ?? '';
    if (!action && req.method === 'GET') return json(await state(env, run));
    if (action === 'storage' && req.method === 'GET') {
      const summary = await env.DB.prepare(
        `SELECT COUNT(a.trial_id) AS saved_count,
        MAX(a.submitted_at) AS last_saved_at FROM trials t
        LEFT JOIN answers a ON a.trial_id=t.id WHERE t.run_id=?`,
      )
        .bind(run.id)
        .first<{ saved_count: number; last_saved_at: string | null }>();
      return json({
        run_id: run.id,
        database: 'constellation-study',
        environment: env.DATA_ENV ?? 'unknown',
        saved_count: summary!.saved_count,
        expected_count: run.trial_count,
        complete: summary!.saved_count === run.trial_count,
        last_saved_at: summary!.last_saved_at,
        answer_mode: run.answer_mode,
        audience: run.audience,
        verified_at: new Date().toISOString(),
      });
    }
    if (action === 'results' && req.method === 'GET') {
      if (await current(env, run)) fail(409, 'Finish the run first.');
      const { results } = await env.DB.prepare(
        `SELECT t.id AS trial_id,t.ordinal,s.dataset,s.difficulty,a.answer,a.skipped,a.correct,a.grading_method,s.label AS correct_answer,
        a.response_time_ms,a.submitted_at FROM trials t JOIN answers a ON a.trial_id=t.id JOIN stimuli s ON s.id=t.stimulus_id
        WHERE t.run_id=? ORDER BY t.ordinal`,
      )
        .bind(run.id)
        .all();
      return json({ run_id: run.id, rows: results });
    }
    const image = action.match(/^image\/([a-f0-9-]+)$/);
    if (image && req.method === 'GET') {
      const trial = await current(env, run);
      if (!trial || trial.id !== image[1]) fail(403, 'Only the current image is available.');
      const s = await env.DB.prepare('SELECT image_path FROM stimuli WHERE id=?')
        .bind(trial!.stimulus_id)
        .first<{ image_path: string }>();
      const assetUrl = new URL(s!.image_path, url.origin);
      const asset = await env.ASSETS.fetch(new Request(assetUrl));
      return new Response(asset.body, {
        status: asset.status,
        headers: {
          'Content-Type': asset.headers.get('Content-Type') ?? 'image/png',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const ready = action.match(/^trials\/([a-f0-9-]+)\/ready$/);
    if (ready && req.method === 'POST') {
      const trial = await current(env, run);
      if (!trial || trial.id !== ready[1]) fail(409, 'Trial is not current.');
      await env.DB.prepare('UPDATE trials SET ready_at=COALESCE(ready_at,?) WHERE id=?')
        .bind(new Date().toISOString(), trial!.id)
        .run();
      return json({ ready: true });
    }
    const answer = action.match(/^trials\/([a-f0-9-]+)\/answer$/);
    if (answer && req.method === 'POST') {
      const data = await body(req),
        trialId = answer[1];
      if (data.skipped !== undefined && typeof data.skipped !== 'boolean')
        fail(400, 'Invalid skip value.');
      const skipped = data.skipped === true;
      const submissionId = text(data.submission_id, 100, /^[a-zA-Z0-9-]{16,100}$/),
        value = skipped ? '' : text(data.answer, 500, /\S/);
      const owned = await env.DB.prepare(
        'SELECT s.dataset,s.label FROM trials t JOIN stimuli s ON s.id=t.stimulus_id WHERE t.id=? AND t.run_id=?',
      )
        .bind(trialId, run.id)
        .first<{ dataset: string; label: string }>();
      if (!owned) fail(404, 'Trial not found.');
      const saved = await env.DB.prepare(
        'SELECT submission_id,answer,skipped FROM answers WHERE trial_id=?',
      )
        .bind(trialId)
        .first<{ submission_id: string; answer: string; skipped: number }>();
      if (saved) {
        if (
          saved.submission_id !== submissionId ||
          saved.answer !== value ||
          Boolean(saved.skipped) !== skipped
        )
          fail(409, 'Answer is already locked.');
        return json(await feedback(env, trialId));
      }
      if (
        !skipped &&
        answerType(owned!.dataset, run.answer_mode) !== 'text' &&
        !(options[owned!.dataset] ?? []).includes(value)
      )
        fail(400, 'Choose one of the provided answers.');
      const grading = grade(owned!.dataset, owned!.label, value, run.answer_mode, skipped);
      const duration = finite(data.response_time_ms, 86400000);
      const events = telemetry(data.telemetry, duration);
      events.summary = summarise(events.events, duration);
      // A single conditional INSERT is the lock: concurrent requests cannot rewrite an answer or skip ahead.
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO answers(trial_id,submission_id,answer,correct,response_time_ms,telemetry_json,skipped,grading_method)
        SELECT t.id,?,?,?,?,?,?,?
        FROM trials t JOIN stimuli s ON s.id=t.stimulus_id WHERE t.id=? AND t.run_id=? AND t.ready_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM trials p LEFT JOIN answers a ON a.trial_id=p.id WHERE p.run_id=t.run_id AND p.ordinal<t.ordinal AND a.trial_id IS NULL)`,
      )
        .bind(
          submissionId,
          value,
          grading.correct,
          duration,
          JSON.stringify(events),
          Number(skipped),
          grading.method,
          trialId,
          run.id,
        )
        .run();
      if (!result.meta.changes) {
        const retry = await env.DB.prepare(
          'SELECT submission_id,answer,skipped FROM answers WHERE trial_id=?',
        )
          .bind(trialId)
          .first<{ submission_id: string; answer: string; skipped: number }>();
        if (
          !retry ||
          retry.submission_id !== submissionId ||
          retry.answer !== value ||
          Boolean(retry.skipped) !== skipped
        )
          fail(409, 'Answer is locked or trial is not ready.');
      }
      return json(await feedback(env, trialId));
    }
  }
  if (
    path.startsWith('/api/') ||
    path.startsWith('/stimuli/') ||
    path === '/stimuli' ||
    /manifest\.json$/.test(path)
  )
    fail(404, 'Not found.');
  if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed.');
  if (/^\/(join|team)(?:\/[^/]+)?\/?$/.test(path)) {
    const response = await env.ASSETS.fetch(
      new Request(new URL('/index.html', url.origin), { method: req.method }),
    );
    const headers = new Headers(response.headers);
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  }
  if (path !== '/' && path !== '/index.html' && !/^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(path))
    fail(404, 'Not found.');
  const response = await env.ASSETS.fetch(req);
  const headers = new Headers(response.headers);
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof Error && /Invalid|Expected|Events must/.test(error.message))
        return json({ error: error.message }, 400);
      console.error('API request failed', error instanceof Error ? error.name : 'UnknownError');
      return json(
        { error: 'Service unavailable. Please retry; your answer has not been changed.' },
        500,
      );
    }
  },
};

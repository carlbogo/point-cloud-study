# Constellation Study

A browser-based recognition study for people and language models. Identify shapes
in point-cloud images, optionally draw lines, and submit or skip each image.
Correct answers and correctness feedback are not shown to participants.

**Stack:** React + Vite, TypeScript Cloudflare Worker, and D1 (SQLite).
The Worker serves the website and API together.

## Run the same study locally

Install **Node.js 24+**, npm, and **Python 3** (`python3` on your PATH). Get the
private `study-dataset.zip` from the organiser and put it in `data/` (create that
folder if needed). Existing checkouts with an imported collection can skip this.

In the project folder:

```sh
npm ci
npm run setup:local
npm run dev:api
```

Setup prints a **local team link** and a **local respondent link**. Open the team
link, not just the hostname. It offers the same 24-image study, block introductions,
link generator, restarts, drawing, skips and storage checks as the cloud version.
The respondent link starts one run with the fixed response format, just like in production.

If the data ZIP is elsewhere, use:

```sh
npm run setup:local -- --dataset /path/to/study-dataset.zip
npm run dev:api
```

Everything runs on your computer. **No Cloudflare account or cloud organiser key
is needed.** Setup creates a private `.dev.vars.local`, local D1 tables, and local
access links saved in `data/local-access.json`. Rerunning setup preserves saved
responses and the team link, and creates a fresh respondent link. Local links
work on the computer running the server; share the code and dataset with team
members who want to run their own instance.

Keep the server running; Ctrl+C stops it. Local responses persist under
`.wrangler/` and are separate from cloud responses. For frontend hot reload,
leave the Worker running and run `npm run dev` in a second terminal; Vite proxies
`/api` to port 8787. `npm run preview` alone cannot run the backend.

To make a transferable private dataset package from an imported collection:

```sh
npm run data:export
```

This writes `data/study-dataset.zip`, including all study images, labels and
sampling metadata, **without participant responses or organiser credentials**.
Share it only with the development team; keep it out of Git and participant links.

For a synthetic **seven-image MNIST software demo only**, use `npm run setup:demo`
and open its printed team link. This is an explicit alternative, not the default
local study. Missing real data does not silently substitute synthetic images.

## Study behaviour

- 24 images in three ordered blocks: MNIST → FashionMNIST → Quickdraw.
- Each block has eight images: 2–2–2–2 at d = 9, 11, 13, 17. Difficulty increases
  within each block. Original images never repeat within a run.
- MNIST (digits 1–9) and FashionMNIST use answer choices. Quickdraw uses free text
  in English. There is one response format, with no mode setting.
- A page before each block explains its response format and image count.
  MNIST and FashionMNIST list their classes; Quickdraw classes are not disclosed.
- Drawing, undo, clear and skip remain available. Saved responses are locked;
  answers, correctness and scores are withheld from participants and their exports.
- Answers, timings and drawing events are saved. Known synonyms are accepted;
  other open answers remain available for review. Skips remain separately marked.

The synthetic demo tests the software, not recognition performance. Actual
perceived difficulty needs a pilot. Difficulty reference:
[Khajuria et al. (2025), Fig. 8](https://doi.org/10.1371/journal.pcbi.1012968).

## Add real images

Ask the organiser for the dataset separately. Imported data, generated images,
secrets and local databases are excluded from Git.

Use square PNGs and a CSV with `image_path,dataset,label,difficulty,source_index`.
Dataset names are `mnist`, `fashion` and `quickdraw`; MNIST uses labels 1–9.
Object labels must match the predefined categories in `worker/grading.ts`.
The importer also handles `fashion_mnist`, `label_name`, and the supplied
`generated_constellations/` path prefix. Keep source IDs stable across levels.

```sh
python3 scripts/import_notebook_dataset.py --metadata /path/to/all_metadata.csv
npm run setup:local
```

Import complete collections before collecting responses. `data/seed.sql` holds
the private answer key and generation metadata. Published PNG filenames are
opaque and image metadata is stripped. Do not run `prepare:demo` over an imported
study unless you intend to switch its active collection to synthetic images.

To replace an existing CIFAR-10 collection with the supplied Quickdraw images:

```sh
python3 scripts/import-quickdraw.py /path/to/quickdraw
npm run data:export
npm run setup:local
```

Quickdraw expects the supplied `metadata.csv` and `d09`, `d11`, `d13`, `d17`
folders. The active Quickdraw classes are guitar, fish, butterfly, tree, umbrella and bicycle.
FashionMNIST is restricted to T-shirt, bag, dress, trousers and sneakers.
Other imported classes are excluded by the server when selecting a run. The new private ZIP replaces the previous dataset package.
Historical runs and their stimuli are retained. Unused old full-study invitations
move to the new protocol when migrations 0006–0007 is applied; started runs keep their
original sequence. Use a new team test run to try the updated protocol.

## Team and respondent links

The **deployed** website requires a link; its homepage alone cannot start a run.

| Link | Who uses it | Behaviour |
| --- | --- | --- |
| `/team/…` | Team members | Reusable; settings, test runs/restarts, respondent-link creation |
| `/join/…` | One respondent | One run; response format fixed when the link is created |

Share the complete URL using **Copy complete link** in the team view. Each
respondent needs their own link. Reusing it in the same browser resumes the saved
session; another browser/device needs a fresh invitation. Team members should
use a team link instead of forwarding one respondent invitation to everybody.
Old `#invite=…` and `#team=…` links are still supported.

Owners can generate links from the terminal:

```sh
node scripts/organiser.mjs team-link --prompt
node scripts/organiser.mjs invite study-2222-v4 --prompt
# Local instance: reads the private local key and URL automatically
node scripts/organiser.mjs team-link --local
node scripts/organiser.mjs invite study-2222-v4 --local
```

Enter the same `ADMIN_TOKEN` stored in Cloudflare. Alternatively save it in private
`.dev.vars`; omit `--prompt` to use it. Set `STUDY_URL` to target a different
website; otherwise the helper uses this project's current deployment.
Team links cannot export all respondents' results or create other team links.

## Publish your own Cloudflare deployment

Local setup and cloud deployment use separate databases. Log in and create D1:

```sh
npx wrangler login
npx wrangler d1 create constellation-study
```

If asked to add a configuration entry automatically, decline. Replace the
existing **top-level** `database_id` in `wrangler.jsonc`; keep `binding: "DB"`,
`migrations_dir`, and `env.local`. Do not add a second database binding.
Production should keep `ALLOW_PUBLIC_RUNS: "false"` and `DATA_ENV: "production"`.

After importing the real image collection:

```sh
npm run db:prepare-cloud
npx wrangler d1 migrations apply constellation-study --remote --env=""
npx wrangler d1 execute constellation-study --remote --env="" --file data/seed-cloudflare.sql
npm run deploy
npx wrangler secret put ADMIN_TOKEN --env=""
```

Create a random organiser secret and save it in a password manager. A deployment
**Version ID is not the organiser secret**. Deploy through the Worker; uploading
`dist` to static hosting alone will not run the study.

## Find saved responses

Cloud data is in D1 `constellation-study`: `runs` → `trials` → `answers`.
Local data is SQLite under `.wrangler/state/v3/d1/` and is not uploaded by deploy.
Team completion pages include **Storage verification**, a run ID and a fresh
**Verify storage again** database check. Team tests are tagged `audience=team`.

```sh
node scripts/organiser.mjs export /private/path/results.json --prompt
```

Exports contain raw answers, telemetry, protocol, audience and grading method.
Participants can export their own completed run as CSV, including its `run_id`.
Refreshing before submission loses that image's unsent drawing and restarts its
client timer. Submitted pending answers are retained for retry. Clearing browser
storage loses the session credential; the organiser must provide a new link.

## Troubleshooting

- **“Invitation required”**: the homepage was opened without the full
  invitation. Open the complete `/join/…` or `/team/…` link. Local setup prints both.
- **“Already started in another browser”**: a single-use respondent link was
  forwarded or its original browser storage was lost. Generate a fresh link.
- **Invalid/incomplete link**: recopy it using the team view's copy button.
- **Port 8787 in use**: stop the other server, or run
  `npx wrangler dev --env local --port 8788` and open that address.
- **No images/full study unavailable**: provide the private dataset ZIP and run
  `setup:local -- --dataset /path/to/study-dataset.zip`. `setup:demo` is only a
  synthetic seven-image software test.
- **401 from organiser commands**: use the stored Cloudflare `ADMIN_TOKEN`, not
  a Version ID. `--prompt` ignores stale environment values.
- **TLS/network error**: check whether the base website opens in a normal browser;
  this happens before the organiser key is checked.

## Code and checks

`src/` is the UI; `worker/` is the API, sampling, grading and access checks;
`migrations/` is the database schema; `scripts/` contains setup/import/admin tools;
`tests/` covers backend behaviour. `dist/` is generated output.

```sh
npm run typecheck
npm test
npm run build
npm run format:check
# With the local Worker running:
node tests/http-smoke.mjs
```

Use `npm run format` for JS/TS/JSX/CSS and `npm run format:python` for Python
(requires Black). Never commit `.dev.vars`, `data/`, `.wrangler/`, credentials,
response exports, or live team/invitation URLs.

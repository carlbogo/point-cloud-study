PRAGMA foreign_keys = ON;
CREATE TABLE stimuli (
  id TEXT PRIMARY KEY,
  image_path TEXT NOT NULL UNIQUE,
  dataset TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  label TEXT NOT NULL,
  source_index TEXT NOT NULL,
  stimulus_source TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(dataset, difficulty, source_index)
);
CREATE INDEX stimuli_condition ON stimuli(active, dataset, difficulty, label);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  dataset TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  invitation_id TEXT UNIQUE REFERENCES invitations(id),
  dataset TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  alias TEXT NOT NULL,
  participant_kind TEXT NOT NULL CHECK(participant_kind IN ('human','model')),
  trial_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE trials (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  ordinal INTEGER NOT NULL,
  stimulus_id TEXT NOT NULL REFERENCES stimuli(id),
  served_at TEXT,
  ready_at TEXT,
  UNIQUE(run_id, ordinal),
  UNIQUE(run_id, stimulus_id)
);
CREATE INDEX trials_stimulus ON trials(stimulus_id);
CREATE TABLE answers (
  trial_id TEXT PRIMARY KEY REFERENCES trials(id),
  submission_id TEXT NOT NULL UNIQUE,
  answer TEXT NOT NULL,
  correct INTEGER,
  response_time_ms REAL NOT NULL,
  telemetry_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

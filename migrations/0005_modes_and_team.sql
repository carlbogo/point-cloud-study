CREATE TABLE study_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), answer_mode TEXT NOT NULL CHECK(answer_mode IN ('hybrid','choices')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO study_settings(id,answer_mode) VALUES(1,'hybrid');
CREATE TABLE team_links (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
ALTER TABLE invitations ADD COLUMN answer_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE runs ADD COLUMN answer_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE runs ADD COLUMN audience TEXT NOT NULL DEFAULT 'respondent';
ALTER TABLE answers ADD COLUMN grading_method TEXT NOT NULL DEFAULT 'legacy';

-- Preserve historical runs while allowing mixed datasets and four difficulty levels.
ALTER TABLE runs ADD COLUMN plan_id TEXT;
ALTER TABLE invitations ADD COLUMN plan_id TEXT;

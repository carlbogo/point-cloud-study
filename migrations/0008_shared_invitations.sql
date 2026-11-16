ALTER TABLE invitations ADD COLUMN reusable INTEGER NOT NULL DEFAULT 0 CHECK (reusable IN (0, 1));
ALTER TABLE runs ADD COLUMN shared_invitation_id TEXT REFERENCES invitations(id);

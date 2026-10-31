CREATE TABLE organizer_credentials (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'main'),
  algorithm TEXT NOT NULL CHECK (algorithm IN ('bootstrap', 'pbkdf2-sha256-v1')),
  salt TEXT,
  password_hash TEXT,
  iterations INTEGER,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  auth_epoch TEXT,
  updated_at INTEGER NOT NULL,
  CHECK (
    (algorithm = 'bootstrap' AND revision = 0 AND salt IS NULL AND password_hash IS NULL AND iterations IS NULL AND auth_epoch IS NULL)
    OR
    (algorithm = 'pbkdf2-sha256-v1' AND revision >= 1 AND salt IS NOT NULL AND password_hash IS NOT NULL AND
      iterations IS NOT NULL AND auth_epoch IS NOT NULL AND length(salt) = 64 AND length(password_hash) = 64 AND
      iterations = 100000 AND length(auth_epoch) = 64)
  )
);
--> statement-breakpoint
INSERT INTO organizer_credentials (id, algorithm, revision, updated_at)
VALUES ('main', 'bootstrap', 0, 0);

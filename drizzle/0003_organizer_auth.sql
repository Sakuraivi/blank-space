CREATE TABLE organizer_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash)=64),
  auth_epoch TEXT NOT NULL CHECK(length(auth_epoch)=64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at)
);
--> statement-breakpoint
CREATE INDEX organizer_sessions_expires ON organizer_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE organizer_login_limits (
  bucket_hash TEXT PRIMARY KEY NOT NULL CHECK(length(bucket_hash)=64),
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts>0),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX organizer_login_limits_updated ON organizer_login_limits(updated_at);

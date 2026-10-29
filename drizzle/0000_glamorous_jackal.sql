CREATE TABLE `pilot_config` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_key` text,
	`iv` text,
	`enabled` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`invite_hash` text,
	`admin_user_id` text
);
--> statement-breakpoint
CREATE TABLE `pilot_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`digest` text NOT NULL,
	`config_version` text NOT NULL,
	`state` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	`outcome` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer
);
--> statement-breakpoint
CREATE INDEX `pilot_requests_session_idx` ON `pilot_requests` (`session_id`);--> statement-breakpoint
CREATE INDEX `pilot_requests_active_idx` ON `pilot_requests` (`state`,`created_at_ms`);
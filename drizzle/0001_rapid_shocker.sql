ALTER TABLE `pilot_requests` ADD `source_mode` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `pilot_requests` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `pilot_requests` ADD `model_id` text;--> statement-breakpoint
ALTER TABLE `pilot_requests` ADD `price_version` text;--> statement-breakpoint
ALTER TABLE `pilot_requests` ADD `reserved_micros` integer DEFAULT 50000 NOT NULL;
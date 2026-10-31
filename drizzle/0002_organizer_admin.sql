CREATE TABLE `organizer_config` (
  `id` text PRIMARY KEY NOT NULL CHECK (`id` = 'main'),
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `pricing_mode` text NOT NULL CHECK (`pricing_mode` IN ('catalog', 'manual')),
  `input_rate` real,
  `output_rate` real,
  `call_limit` integer,
  `shared_budget_micros` integer,
  `encrypted_key` text,
  `iv` text,
  `enabled` integer DEFAULT 0 NOT NULL CHECK (`enabled` IN (0, 1)),
  `revision` integer NOT NULL CHECK (`revision` >= 1),
  `updated_at_ms` integer NOT NULL
);

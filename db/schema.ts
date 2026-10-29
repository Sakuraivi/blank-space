import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export const pilotConfig = sqliteTable('pilot_config', {
  id: text('id').primaryKey(),
  encryptedKey: text('encrypted_key'),
  iv: text('iv'),
  enabled: integer('enabled').notNull().default(0),
  revision: integer('revision').notNull().default(0),
  inviteHash: text('invite_hash'),
  adminUserId: text('admin_user_id'),
});

export const pilotRequests = sqliteTable('pilot_requests', {
  requestId: text('request_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  digest: text('digest').notNull(),
  configVersion: text('config_version').notNull(),
  state: text('state').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  finishedAtMs: integer('finished_at_ms'),
  outcome: text('outcome'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
}, table => [
  index('pilot_requests_session_idx').on(table.sessionId),
  index('pilot_requests_active_idx').on(table.state, table.createdAtMs),
]);

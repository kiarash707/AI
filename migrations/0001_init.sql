CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_conv_created ON messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_links (telegram_user_id TEXT PRIMARY KEY, active_conversation_id TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_updates (update_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, conversation_id TEXT, owner_id TEXT NOT NULL, status TEXT NOT NULL, input TEXT NOT NULL, output TEXT, step TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS model_events (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, requested_model TEXT, used_model TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner_updated ON projects(owner_id, updated_at);

CREATE TABLE IF NOT EXISTS workspace_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_tasks_owner_updated ON workspace_tasks(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS workspace_tasks_project ON workspace_tasks(project_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_owner_updated ON memories(owner_id, updated_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_log_owner_created ON activity_log(owner_id, created_at);

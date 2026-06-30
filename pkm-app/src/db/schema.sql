CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  markdown    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS note_revisions (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  markdown   TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  deadline    INTEGER,
  urgency     TEXT CHECK (urgency IS NULL OR urgency IN ('urgent', 'normal')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_refs (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (task_id, note_id)
);

CREATE TABLE IF NOT EXISTS subtasks (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  sort_order  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS note_links (
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  raw_target     TEXT NOT NULL,
  link_type      TEXT NOT NULL DEFAULT 'wiki' CHECK (link_type IN ('wiki', 'suggested')),
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (source_note_id, raw_target)
);

CREATE INDEX IF NOT EXISTS idx_task_refs_note   ON task_refs(note_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task    ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_note_links_src   ON note_links(source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_tgt   ON note_links(target_note_id);

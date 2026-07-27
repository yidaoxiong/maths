export const practiceSchemaSql = `CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  user_id TEXT,
  practice_date TEXT NOT NULL,
  total_questions INTEGER NOT NULL,
  correct_answers INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  mistake_count INTEGER NOT NULL,
  practice_type TEXT NOT NULL DEFAULT 'legacy',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function addColumnIfMissing(db, columns, name, sql) {
  if (!columns.has(name)) {
    await db.prepare(sql).run();
    columns.add(name);
  }
}

export async function ensurePracticeDatabase(db) {
  await db.batch([
    db.prepare(practiceSchemaSql),
    db.prepare('CREATE INDEX IF NOT EXISTS practice_sessions_client_date_idx ON practice_sessions (client_id, practice_date)'),
  ]);
  const { results } = await db.prepare('PRAGMA table_info(practice_sessions)').all();
  const columns = new Set(results.map(column => column.name));
  await addColumnIfMissing(db, columns, 'practice_type', "ALTER TABLE practice_sessions ADD COLUMN practice_type TEXT NOT NULL DEFAULT 'legacy'");
  await addColumnIfMissing(db, columns, 'user_id', 'ALTER TABLE practice_sessions ADD COLUMN user_id TEXT');
  await db.prepare('CREATE INDEX IF NOT EXISTS practice_sessions_user_date_idx ON practice_sessions (user_id, practice_date)').run();
}

export function isValidClientId(value) {
  return typeof value === 'string' && value.length >= 20 && value.length <= 80;
}

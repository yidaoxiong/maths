const schemaSql = `CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  practice_date TEXT NOT NULL,
  total_questions INTEGER NOT NULL,
  correct_answers INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  mistake_count INTEGER NOT NULL,
  practice_type TEXT NOT NULL DEFAULT 'legacy',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function ensureDatabase(db) {
  await db.batch([
    db.prepare(schemaSql),
    db.prepare('CREATE INDEX IF NOT EXISTS practice_sessions_client_date_idx ON practice_sessions (client_id, practice_date)'),
  ]);
  const { results } = await db.prepare('PRAGMA table_info(practice_sessions)').all();
  if (!results.some(column => column.name === 'practice_type')) {
    await db.prepare("ALTER TABLE practice_sessions ADD COLUMN practice_type TEXT NOT NULL DEFAULT 'legacy'").run();
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function isValidClientId(value) {
  return typeof value === 'string' && value.length >= 20 && value.length <= 80;
}

export async function onRequestGet({ request, env }) {
  const clientId = new URL(request.url).searchParams.get('clientId');
  if (!isValidClientId(clientId)) return json({ error: 'Invalid device.' }, 400);
  await ensureDatabase(env.DB);
  const { results } = await env.DB.prepare(`
    SELECT practice_date AS date,
           SUM(total_questions) AS total,
           SUM(correct_answers) AS correct,
           SUM(elapsed_seconds) AS elapsed,
           SUM(mistake_count) AS mistakes,
           COUNT(*) AS sessions,
           MAX(CASE WHEN practice_type = 'add-subtract' THEN 1 ELSE 0 END) AS add_subtract_done,
           MAX(CASE WHEN practice_type = 'multiply-divide' THEN 1 ELSE 0 END) AS multiply_divide_done,
           ROUND(AVG(correct_answers * 100.0 / total_questions)) AS score,
           CASE WHEN SUM(elapsed_seconds) > 0
             THEN ROUND(SUM(total_questions) * 60.0 / SUM(elapsed_seconds), 1)
             ELSE 0
           END AS speed
      FROM practice_sessions
     WHERE client_id = ?
     GROUP BY practice_date
     ORDER BY practice_date DESC
     LIMIT 60
  `).bind(clientId).all();
  return json({ days: results });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const allowedTypes = ['add-subtract', 'multiply-divide', 'smart'];
  if (!body || !isValidClientId(body.clientId) || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !allowedTypes.includes(body.practiceType)) return json({ error: 'Invalid session.' }, 400);
  const fields = ['total', 'correct', 'elapsed', 'mistakes'].map(key => Number(body[key]));
  const [total, correct, elapsed, mistakes] = fields;
  if (!fields.every(Number.isInteger) || total < 1 || correct < 0 || correct > total || elapsed < 0 || mistakes < 0 || mistakes > total) return json({ error: 'Invalid results.' }, 400);
  await ensureDatabase(env.DB);
  await env.DB.prepare(`
    INSERT INTO practice_sessions (client_id, practice_date, total_questions, correct_answers, elapsed_seconds, mistake_count, practice_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(body.clientId, body.date, total, correct, elapsed, mistakes, body.practiceType).run();
  return json({ ok: true }, 201);
}

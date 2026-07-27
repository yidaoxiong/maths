import { ensurePracticeDatabase, isValidClientId } from './_db.js';
import { ensureAuthTables, getSessionUser } from './_auth.js';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export async function onRequestGet({ request, env }) {
  const clientId = new URL(request.url).searchParams.get('clientId');
  await ensurePracticeDatabase(env.DB);
  await ensureAuthTables(env.DB);
  const user = await getSessionUser(request, env.DB);
  if (!user && !isValidClientId(clientId)) return json({ error: 'Invalid device.' }, 400);
  const where = user ? 'user_id = ?' : 'client_id = ? AND user_id IS NULL';
  const key = user ? user.id : clientId;
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
           CASE WHEN SUM(elapsed_seconds) > 0 THEN ROUND(SUM(total_questions) * 60.0 / SUM(elapsed_seconds), 1) ELSE 0 END AS speed
      FROM practice_sessions WHERE ${where}
     GROUP BY practice_date ORDER BY practice_date DESC LIMIT 60
  `).bind(key).all();
  const { results: typeResults } = await env.DB.prepare(`
    SELECT practice_date AS date,
           practice_type AS type,
           SUM(total_questions) AS total,
           SUM(correct_answers) AS correct,
           SUM(elapsed_seconds) AS elapsed,
           COUNT(*) AS sessions,
           ROUND(AVG(correct_answers * 100.0 / total_questions)) AS score,
           CASE WHEN SUM(elapsed_seconds) > 0 THEN ROUND(SUM(total_questions) * 60.0 / SUM(elapsed_seconds), 1) ELSE 0 END AS speed
      FROM practice_sessions
     WHERE ${where} AND practice_type IN ('add-subtract', 'multiply-divide', 'smart')
     GROUP BY practice_date, practice_type
     ORDER BY practice_date DESC
     LIMIT 180
  `).bind(key).all();
  const categoryDays = { 'add-subtract': [], 'multiply-divide': [], smart: [] };
  for (const row of typeResults) categoryDays[row.type]?.push(row);
  return json({ days: results, categoryDays, user: user ? { username: user.username } : null });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const allowedTypes = ['add-subtract', 'multiply-divide', 'smart'];
  if (!body || !isValidClientId(body.clientId) || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !allowedTypes.includes(body.practiceType)) return json({ error: 'Invalid session.' }, 400);
  const fields = ['total', 'correct', 'elapsed', 'mistakes'].map(key => Number(body[key]));
  const [total, correct, elapsed, mistakes] = fields;
  if (!fields.every(Number.isInteger) || total < 1 || correct < 0 || correct > total || elapsed < 0 || mistakes < 0 || mistakes > total) return json({ error: 'Invalid results.' }, 400);
  await ensurePracticeDatabase(env.DB);
  await ensureAuthTables(env.DB);
  const user = await getSessionUser(request, env.DB);
  await env.DB.prepare(`INSERT INTO practice_sessions (client_id, user_id, practice_date, total_questions, correct_answers, elapsed_seconds, mistake_count, practice_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(body.clientId, user ? user.id : null, body.date, total, correct, elapsed, mistakes, body.practiceType).run();
  return json({ ok: true });
}

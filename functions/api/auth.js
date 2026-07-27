import { ensurePracticeDatabase, isValidClientId } from './_db.js';
import { clearSession, createSession, ensureAuthTables, getSessionUser, hashPassword, newSalt, validCredentials } from './_auth.js';

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

async function linkDeviceHistory(db, userId, clientId) {
  if (!isValidClientId(clientId)) return;
  await db.prepare('UPDATE practice_sessions SET user_id = ? WHERE client_id = ? AND user_id IS NULL').bind(userId, clientId).run();
}

export async function onRequestGet({ request, env }) {
  await ensureAuthTables(env.DB);
  const user = await getSessionUser(request, env.DB);
  return json({ user: user || null });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return json({ error: '请求无效。' }, 400);
  await ensureAuthTables(env.DB);

  if (body.action === 'logout') {
    return json({ ok: true }, 200, { 'Set-Cookie': await clearSession(request, env.DB) });
  }

  if (!validCredentials(body.username, body.password)) return json({ error: '账号为 3–24 个字母、数字或汉字；密码至少 8 位。' }, 400);

  let user;
  if (body.action === 'register') {
    const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').bind(body.username).first();
    if (exists) return json({ error: '这个账号名已经被使用。' }, 409);
    const salt = newSalt();
    user = { id: crypto.randomUUID(), username: body.username };
    await env.DB.prepare('INSERT INTO users (id, username, password_hash, password_salt) VALUES (?, ?, ?, ?)').bind(user.id, user.username, await hashPassword(body.password, salt), salt).run();
  } else if (body.action === 'login') {
    const stored = await env.DB.prepare('SELECT id, username, password_hash, password_salt FROM users WHERE username = ? LIMIT 1').bind(body.username).first();
    if (!stored || await hashPassword(body.password, stored.password_salt) !== stored.password_hash) return json({ error: '账号或密码不正确。' }, 401);
    user = { id: stored.id, username: stored.username };
  } else {
    return json({ error: '请求无效。' }, 400);
  }

  await ensurePracticeDatabase(env.DB);
  await linkDeviceHistory(env.DB, user.id, body.clientId);
  return json({ user }, 200, { 'Set-Cookie': await createSession(env.DB, user.id) });
}

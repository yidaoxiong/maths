import { ensurePracticeDatabase, isValidClientId } from './_db.js';
import { clearSession, createSession, ensureAuthTables, getSessionUser, hashPassword, refreshSharedSessionCookie, safeEqual, validCredentials, validPasswordProof, validPasswordSalt, validUsername } from './_auth.js';

function json(payload, status = 200, cookies = []) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(payload), { status, headers });
}

async function linkDeviceHistory(db, userId, clientId) {
  if (!isValidClientId(clientId)) return;
  await db.prepare('UPDATE practice_sessions SET user_id = ? WHERE client_id = ? AND user_id IS NULL').bind(userId, clientId).run();
}

export async function onRequestGet({ request, env }) {
  await ensureAuthTables(env.DB);
  const user = await getSessionUser(request, env.DB);
  const cookie = user ? refreshSharedSessionCookie(request) : null;
  return json({ user: user || null }, 200, cookie ? [cookie] : []);
}

export async function onRequestPost(context) {
  try {
    return await handlePost(context);
  } catch {
    return json({ error: '账号服务暂时不可用，请稍后再试。' }, 503);
  }
}

async function handlePost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return json({ error: '请求无效。' }, 400);
  await ensureAuthTables(env.DB);

  if (body.action === 'logout') {
    return json({ ok: true }, 200, await clearSession(request, env.DB));
  }

  if (body.action === 'challenge') {
    if (!validUsername(body.username)) return json({ error: '账号格式不正确。' }, 400);
    const stored = await env.DB.prepare('SELECT password_salt, password_scheme FROM users WHERE username = ? LIMIT 1').bind(body.username).first();
    if (!stored) return json({ error: '账号或密码不正确。' }, 401);
    return json({ scheme: stored.password_scheme, salt: stored.password_scheme === 'client-v1' ? stored.password_salt : null });
  }

  let user;
  if (body.action === 'register') {
    if (!validUsername(body.username) || !validPasswordProof(body.passwordProof) || !validPasswordSalt(body.passwordSalt)) return json({ error: '账号或密码格式不正确。' }, 400);
    const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').bind(body.username).first();
    if (exists) return json({ error: '这个账号名已经被使用。' }, 409);
    user = { id: crypto.randomUUID(), username: body.username };
    await env.DB.prepare('INSERT INTO users (id, username, password_hash, password_salt, password_scheme) VALUES (?, ?, ?, ?, ?)').bind(user.id, user.username, body.passwordProof, body.passwordSalt, 'client-v1').run();
  } else if (body.action === 'login') {
    if (!validUsername(body.username)) return json({ error: '账号格式不正确。' }, 400);
    const stored = await env.DB.prepare('SELECT id, username, password_hash, password_salt, password_scheme FROM users WHERE username = ? LIMIT 1').bind(body.username).first();
    if (!stored) return json({ error: '账号或密码不正确。' }, 401);
    const correct = stored.password_scheme === 'client-v1'
      ? validPasswordProof(body.passwordProof) && safeEqual(body.passwordProof, stored.password_hash)
      : validCredentials(body.username, body.password) && safeEqual(await hashPassword(body.password, stored.password_salt), stored.password_hash);
    if (!correct) return json({ error: '账号或密码不正确。' }, 401);
    user = { id: stored.id, username: stored.username };
  } else {
    return json({ error: '请求无效。' }, 400);
  }

  await ensurePracticeDatabase(env.DB);
  await linkDeviceHistory(env.DB, user.id, body.clientId);
  return json({ user }, 200, [await createSession(env.DB, user.id)]);
}

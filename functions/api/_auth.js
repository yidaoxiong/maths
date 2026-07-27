const encoder = new TextEncoder();
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function sha256(value) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(salt), iterations: 210000 }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

export function newSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function parseCookie(request, name) {
  const value = request.headers.get('Cookie') || '';
  const part = value.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : null;
}

export async function ensureAuthTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id)'),
  ]);
}

export async function getSessionUser(request, db) {
  const token = parseCookie(request, 'maths_session');
  if (!token) return null;
  const tokenHash = await sha256(token);
  return db.prepare(`SELECT users.id, users.username
      FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
     LIMIT 1`).bind(tokenHash, new Date().toISOString()).first();
}

export async function createSession(db, userId) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = bytesToBase64Url(bytes);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(new Date().toISOString()),
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, expiresAt),
  ]);
  return `maths_session=${token}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function clearSession(request, db) {
  const token = parseCookie(request, 'maths_session');
  if (token) await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return 'maths_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';
}

export function validCredentials(username, password) {
  return typeof username === 'string' && /^[A-Za-z0-9_\-\u4e00-\u9fff]{3,24}$/.test(username) && typeof password === 'string' && password.length >= 8 && password.length <= 72;
}

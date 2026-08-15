const encoder = new TextEncoder();
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const SHARED_COOKIE = 'slashbro_session';
const LEGACY_COOKIE = 'maths_session';
const COOKIE_SUFFIX = 'Max-Age=' + SESSION_MAX_AGE + '; Domain=slashbro.top; Path=/; HttpOnly; Secure; SameSite=Lax';

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

function parseCookie(request, name) {
  const value = request.headers.get('Cookie') || '';
  const part = value.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : null;
}

function sessionTokens(request) {
  return [...new Set([parseCookie(request, SHARED_COOKIE), parseCookie(request, LEGACY_COOKIE)].filter(Boolean))];
}

export async function ensureAuthTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_scheme TEXT NOT NULL DEFAULT 'server-v1',
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
  const { results } = await db.prepare('PRAGMA table_info(users)').all();
  if (!results.some(column => column.name === 'password_scheme')) {
    await db.prepare("ALTER TABLE users ADD COLUMN password_scheme TEXT NOT NULL DEFAULT 'server-v1'").run();
  }
}

export async function getSessionUser(request, db) {
  for (const token of sessionTokens(request)) {
    const user = await db.prepare(`SELECT users.id, users.username
        FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
       LIMIT 1`).bind(await sha256(token), new Date().toISOString()).first();
    if (user) return user;
  }
  return null;
}

export function refreshSharedSessionCookie(request) {
  const token = sessionTokens(request)[0];
  return token ? `${SHARED_COOKIE}=${token}; ${COOKIE_SUFFIX}` : null;
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
  return `${SHARED_COOKIE}=${token}; ${COOKIE_SUFFIX}`;
}

export async function clearSession(request, db) {
  for (const token of sessionTokens(request)) {
    await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return [
    `${SHARED_COOKIE}=; Max-Age=0; Domain=slashbro.top; Path=/; HttpOnly; Secure; SameSite=Lax`,
    `${LEGACY_COOKIE}=; Max-Age=0; Domain=slashbro.top; Path=/; HttpOnly; Secure; SameSite=Lax`,
    `${LEGACY_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
  ];
}

export function validCredentials(username, password) {
  return validUsername(username) && typeof password === 'string' && password.length >= 8 && password.length <= 72;
}

export function validUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9_\-\u4e00-\u9fff]{3,24}$/.test(username);
}

export function validPasswordProof(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function validPasswordSalt(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
}

export function safeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

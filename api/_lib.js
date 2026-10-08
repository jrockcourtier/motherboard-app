// Outils partagés pour la connexion Google permanente (fichier non exposé comme route : commence par "_")
// Le "refresh token" Google est chiffré (AES-256-GCM) et gardé dans un cookie sécurisé du navigateur.
// Variables d'environnement Vercel requises : GOOGLE_CLIENT_SECRET, COOKIE_SECRET
const crypto = require('crypto');

const CLIENT_ID = '331553953189-ri23lfat50mtim15fjghlhrf3hjegmfi.apps.googleusercontent.com';
const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
const RT_COOKIE = 'mb_rt';
const MAX_AGE = 400 * 24 * 3600; // maximum permis par les navigateurs

function configured() {
  return !!(process.env.GOOGLE_CLIENT_SECRET && process.env.COOKIE_SECRET);
}

function key() {
  return crypto.createHash('sha256').update(process.env.COOKIE_SECRET).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

function decrypt(b64) {
  try {
    const buf = Buffer.from(b64, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, maxAge) {
  const prev = res.getHeader('Set-Cookie') || [];
  const list = Array.isArray(prev) ? prev : [prev];
  list.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
  res.setHeader('Set-Cookie', list);
}

function origin(req) {
  return `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// ---------- Session (refresh token + courriel du compte Google) ----------
const ALLOWED = (process.env.ALLOWED_EMAILS || 'jrockcourtier@gmail.com').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
function allowed(email) { return !!email && ALLOWED.includes(String(email).toLowerCase()); }

function readSession(req) {
  const raw = decrypt(cookies(req)[RT_COOKIE] || '');
  if (!raw) return null;
  try { const s = JSON.parse(raw); if (s && s.rt) return s; } catch (e) {}
  return { rt: raw, email: null }; // ancien format (avant v8)
}
function writeSession(res, s) { setCookie(res, RT_COOKIE, encrypt(JSON.stringify(s)), MAX_AGE); }
function clearSession(res) { setCookie(res, RT_COOKIE, '', 0); }

function emailFromIdToken(idt) {
  try { return JSON.parse(Buffer.from(String(idt).split('.')[1], 'base64url').toString('utf8')).email || null; }
  catch (e) { return null; }
}

async function refresh(rt) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' })
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

// Vérifie que la requête vient bien de Julien (cookie valide + courriel autorisé). Renvoie le courriel ou null.
async function requireOwner(req, res) {
  if (!configured()) { json(res, 503, { error: 'not_configured' }); return null; }
  const s = readSession(req);
  if (!s) { json(res, 401, { error: 'not_connected' }); return null; }
  let email = s.email;
  if (!email) {
    const { ok, data } = await refresh(s.rt);
    if (!ok) { json(res, 401, { error: 'reconnect' }); return null; }
    email = emailFromIdToken(data.id_token);
    if (email) writeSession(res, { rt: s.rt, email });
  }
  if (!allowed(email)) { json(res, 403, { error: 'not_allowed' }); return null; }
  return email;
}

// ---------- Supabase (base de données) ----------
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://luynpgieqbszsqucldal.supabase.co').replace(/\/$/, '');
function supabaseKey() { return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }
async function sb(path, opts = {}) {
  const key = supabaseKey();
  const headers = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, opts.headers || {});
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key; // ancienne clé "service_role" (JWT)
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, opts, { headers }));
  const text = await r.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { ok: r.ok, status: r.status, body };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return null; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch (e) { return null; }
}

module.exports = { CLIENT_ID, SCOPE, RT_COOKIE, MAX_AGE, configured, encrypt, decrypt, cookies, setCookie, origin, json,
  allowed, readSession, writeSession, clearSession, emailFromIdToken, refresh, requireOwner, sb, supabaseKey, readBody };

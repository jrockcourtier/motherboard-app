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

module.exports = { CLIENT_ID, SCOPE, RT_COOKIE, MAX_AGE, configured, encrypt, decrypt, cookies, setCookie, origin, json };

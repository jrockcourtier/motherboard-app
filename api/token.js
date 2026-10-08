// Donne à l'app un accès Google frais (valide ~1 h) à partir du refresh token gardé dans le cookie.
// L'app l'appelle automatiquement : plus besoin de se reconnecter.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (!L.configured()) return L.json(res, 503, { error: 'not_configured' });
  const rt = L.decrypt(L.cookies(req)[L.RT_COOKIE] || '');
  if (!rt) return L.json(res, 401, { error: 'not_connected' });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: L.CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: rt,
      grant_type: 'refresh_token'
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.error === 'invalid_grant') L.setCookie(res, L.RT_COOKIE, '', 0);
    return L.json(res, 401, { error: data.error || 'refresh_failed' });
  }
  // Prolonge le cookie à chaque utilisation
  L.setCookie(res, L.RT_COOKIE, L.encrypt(rt), L.MAX_AGE);
  L.json(res, 200, { access_token: data.access_token, expires_in: data.expires_in });
};

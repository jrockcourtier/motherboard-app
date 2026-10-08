// Étape 2 : Google revient ici avec un code ; on l'échange contre un "refresh token" gardé chiffré dans un cookie
const L = require('../_lib');

module.exports = async (req, res) => {
  const url = new URL(req.url, L.origin(req));
  const back = (q) => { res.statusCode = 302; res.setHeader('Location', '/?' + q); res.end(); };

  if (url.searchParams.get('error')) return back('auth_error=' + encodeURIComponent(url.searchParams.get('error')));
  const c = L.cookies(req);
  if (!c.mb_state || c.mb_state !== url.searchParams.get('state')) return back('auth_error=state');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: L.CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: L.origin(req) + '/api/auth/callback',
      grant_type: 'authorization_code'
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.refresh_token) return back('auth_error=' + encodeURIComponent(data.error || 'no_refresh_token'));

  const email = L.emailFromIdToken(data.id_token);
  L.setCookie(res, 'mb_state', '', 0);
  if (!L.allowed(email)) return back('auth_error=' + encodeURIComponent('compte non autorisé (' + (email || '?') + ')'));
  L.writeSession(res, { rt: data.refresh_token, email });
  back('connected=1');
};

// Donne à l'app un accès Google frais (valide ~1 h) à partir du refresh token gardé dans le cookie.
// L'app l'appelle automatiquement : plus besoin de se reconnecter.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (!L.configured()) return L.json(res, 503, { error: 'not_configured' });
  const s = L.readSession(req);
  if (!s) return L.json(res, 401, { error: 'not_connected' });

  const { ok, data } = await L.refresh(s.rt);
  if (!ok) {
    if (data.error === 'invalid_grant') L.clearSession(res);
    return L.json(res, 401, { error: data.error || 'refresh_failed' });
  }
  const email = L.emailFromIdToken(data.id_token) || s.email || null;
  if (email && !L.allowed(email)) { L.clearSession(res); return L.json(res, 403, { error: 'not_allowed' }); }
  // Prolonge le cookie à chaque utilisation (et passe au nouveau format avec le courriel)
  L.writeSession(res, { rt: s.rt, email });
  L.json(res, 200, { access_token: data.access_token, expires_in: data.expires_in, scope: data.scope || '', email });
};

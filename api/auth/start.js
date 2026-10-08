// Étape 1 : envoie l'utilisateur vers Google pour autoriser la lecture du calendrier (une seule fois par appareil)
const crypto = require('crypto');
const L = require('../_lib');

module.exports = (req, res) => {
  if (!L.configured()) {
    res.statusCode = 302;
    res.setHeader('Location', '/?auth_error=not_configured');
    return res.end();
  }
  const state = crypto.randomBytes(16).toString('hex');
  L.setCookie(res, 'mb_state', state, 600);
  const params = new URLSearchParams({
    client_id: L.CLIENT_ID,
    redirect_uri: L.origin(req) + '/api/auth/callback',
    response_type: 'code',
    scope: L.SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: 'jrockcourtier@gmail.com',
    state
  });
  res.statusCode = 302;
  res.setHeader('Location', 'https://accounts.google.com/o/oauth2/v2/auth?' + params);
  res.end();
};

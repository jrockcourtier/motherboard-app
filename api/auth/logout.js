// Déconnecte Google sur cet appareil
const L = require('../_lib');

module.exports = (req, res) => {
  L.setCookie(res, L.RT_COOKIE, '', 0);
  res.statusCode = 302;
  res.setHeader('Location', '/');
  res.end();
};

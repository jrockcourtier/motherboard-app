// Vérification rapide de la configuration (aucune donnée personnelle renvoyée)
const L = require('./_lib');
module.exports = async (req, res) => {
  const out = { google: L.configured(), dbKey: !!L.supabaseKey(), db: 'non testée' };
  if (out.dbKey) {
    const r = await L.sb('contacts?select=id&limit=1');
    out.db = r.ok ? 'ok' : `erreur ${r.status}${r.body && r.body.message ? ' : ' + r.body.message : ''}`;
  }
  L.json(res, 200, out);
};

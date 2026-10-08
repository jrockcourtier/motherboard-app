// Vérification rapide de la configuration (aucune donnée personnelle renvoyée)
const L = require('./_lib');
module.exports = async (req, res) => {
  const out = { google: L.configured(), dbKey: !!L.supabaseKey(), db: 'non testée' };
  if (out.dbKey) {
    try {
      const r = await L.sb('contacts?select=id&limit=1');
      out.db = r.ok ? 'ok' : `erreur ${r.status}${r.body && r.body.message ? ' : ' + r.body.message : ''}`;
    } catch (e) {
      out.db = 'injoignable : ' + (e.cause && e.cause.code ? e.cause.code : e.message);
      out.url = (process.env.SUPABASE_URL || 'défaut').slice(0, 60);
    }
  }
  L.json(res, 200, out);
};

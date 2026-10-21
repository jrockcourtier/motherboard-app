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
  if (out.dbKey) {
    try {
      const key = L.supabaseKey(), h = { apikey: key }; if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
      const r = await fetch((process.env.SUPABASE_URL || 'https://luynpgieqbszsqucldal.supabase.co').replace(/\/$/, '') + '/storage/v1/bucket/fiches', { headers: h });
      out.storage = r.ok ? 'ok' : 'erreur ' + r.status;
    } catch (e) { out.storage = 'injoignable'; }
  }
  L.json(res, 200, out);
};

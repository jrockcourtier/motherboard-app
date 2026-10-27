// Boîte « À classer » : reçoit une fiche contact (vCard) envoyée par le raccourci iPhone « Envoyer à Motherboard ».
// GET  /api/inbox            (connecté avec Google) -> { key, url } à coller dans le raccourci
// POST /api/inbox            en-tête x-mb-key: <clé>, corps = la vCard (ou du texte : nom + numéro)
const crypto = require('crypto');
const L = require('./_lib');

function inboxKey() { return crypto.createHmac('sha256', process.env.COOKIE_SECRET || '').update('mb-inbox-v1').digest('base64url').slice(0, 32); }
function sameKey(a) { const b = inboxKey(); try { return a && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; } }

function unfold(v) { return String(v || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, ''); }
function val(s) { return String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim(); }
function parseVcards(txt) {
  const cards = unfold(txt).split(/BEGIN:VCARD/i).slice(1);
  return cards.map(card => {
    const c = { phones: [], emails: [] };
    card.split(/\r?\n/).forEach(line => {
      const i = line.indexOf(':'); if (i < 0) return;
      const k = line.slice(0, i).toUpperCase(), v = line.slice(i + 1);
      const base = k.split(';')[0].replace(/^ITEM\d+\./, '');
      if (base === 'FN') c.fn = val(v);
      else if (base === 'N') { const p = v.split(';').map(val); c.n = [p[1], p[0]].filter(Boolean).join(' '); }
      else if (base === 'TEL') c.phones.push(val(v));
      else if (base === 'EMAIL') c.emails.push(val(v));
      else if (base === 'NOTE') c.note = val(v);
      else if (base === 'ADR') c.adr = val(v.split(';').filter(Boolean).join(', '));
      else if (base === 'ORG') c.org = val(v.split(';')[0]);
    });
    return c;
  }).filter(c => c.fn || c.n || c.phones.length);
}
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
function fmtPhone(s) { const d = digits(s); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(s || '').trim(); }

async function raw(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return req.body.vcard || req.body.text || JSON.stringify(req.body);
  const ch = []; for await (const c of req) ch.push(c); return Buffer.concat(ch).toString('utf8');
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const email = await L.requireOwner(req, res); if (!email) return;
      return L.json(res, 200, { key: inboxKey(), url: L.origin(req) + '/api/inbox' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return L.json(res, 405, { error: 'method_not_allowed' }); }
    const k = req.headers['x-mb-key'] || new URL(req.url, 'http://x').searchParams.get('k') || '';
    if (!sameKey(String(k))) { res.statusCode = 401; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('⛔ Clé invalide : recopie la clé du raccourci depuis Motherboard (Contacts → bouton 📲).'); }
    let txt = (await raw(req)).slice(0, 200000);
    let cards = parseVcards(txt);
    if (!cards.length) {   // texte libre : « Marie Tremblay 514 555-1234 »
      const ph = txt.match(/\+?1?[\s.(-]*\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/);
      const name = txt.replace(ph ? ph[0] : '', '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (ph || name) cards = [{ fn: name, phones: ph ? [ph[0]] : [], emails: [] }];
    }
    if (!cards.length) { res.statusCode = 400; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('⚠️ Aucune fiche contact reçue.'); }
    const ex = await L.sb('contacts?select=id,data&limit=5000');
    const known = {};
    (ex.body || []).forEach(r => { const d = r.data || {}; if (d.deleted) return; [d.phone, d.phone2].forEach(p => { const x = digits(p); if (x.length >= 10) known[x] = { name: d.name || 'contact', id: r.id }; }); });
    const now = new Date().toISOString(), rows = [], msgs = []; let firstId = null;
    cards.slice(0, 20).forEach(c => {
      const name = (c.fn || c.n || '').trim() || fmtPhone(c.phones[0]) || 'Contact sans nom';
      const ph = c.phones.map(fmtPhone);
      const dup = ph.map(digits).find(x => known[x]);
      if (dup) { msgs.push(`ℹ️ ${name} est déjà dans Motherboard (${known[dup].name})`); firstId = firstId || known[dup].id; return; }
      const id = crypto.randomUUID(); firstId = firstId || id;
      rows.push({ id, updated_at: now, data: { id, inbox: true, type: 'acheteur', name, phone: ph[0] || '', phone2: ph[1] || '', email: c.emails[0] || '', address: c.adr || '', source: 'iPhone', firstContact: now.slice(0, 10), lastContact: now.slice(0, 10),
        notes: [{ id: crypto.randomUUID(), at: now, text: '📲 Reçu de l\'iPhone' + (c.note ? ' — ' + c.note : '') + (c.org ? ' · ' + c.org : '') }], calls: [], createdAt: now, updatedAt: now } });
      msgs.push(`✅ ${name} ajouté à Motherboard (À classer)`);
    });
    if (rows.length) {
      const r = await L.sb('contacts?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
      if (!r.ok) { res.statusCode = 502; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('⚠️ Motherboard n\'a pas pu enregistrer le contact. Réessaie dans un instant.'); }
    }
    res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    // ?ouvrir=1 : on répond seulement le lien de la fiche, que le raccourci ouvre (« Ouvrir les URL ») pour la modifier tout de suite
    if (new URL(req.url, 'http://x').searchParams.get('ouvrir') && firstId) return res.end(`${L.origin(req)}/?fiche=${firstId}`);
    res.end(msgs.join('\n'));
  } catch (e) {
    res.statusCode = 502; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('⚠️ Erreur : ' + e.message);
  }
};

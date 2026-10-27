// Motherboard — Transactions : dossiers d'achat / de vente, conditions et dates limites (avec rappels urgents dans Google Agenda)
// Règles de Julien :
//  · le jour 1 = le lendemain de l'acceptation → date limite de N jours = acceptation + N jours
//  · Inspection « X jours » : rappel à la fin des X jours (inspection faite) + date limite de l'avis à X + 4 jours (avant 20 h selon le formulaire)
//  · Examen des documents « X jours » : documents à recevoir à X jours + date limite de l'avis à X + 7 jours
//  · Financement, vente d'une propriété, autres : nombre de jours tel qu'écrit
//  · heure limite par défaut 19 h · alertes la veille à 9 h et le matin même à 9 h
(function () {
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s || ''));
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (x) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) {} } };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const addD = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const diffD = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  const fmtD = (s, long) => s ? new Date(s + 'T12:00:00').toLocaleDateString('fr-CA', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const hh = (t) => { const [h, m] = String(t || '19:00').split(':'); return `${+h} h${m && m !== '00' ? m : ''}`; };
  const money = (n) => n ? Math.round(n).toLocaleString('fr-CA') + ' $' : '';
  const toastMsg = (t, ms) => { if (typeof toast === 'function') toast(t, ms); };

  const CTYPES = {
    inspection:  { label: 'Inspection', icon: '🔍', extra: 4, extraLabel: 'avis au vendeur' },
    financement: { label: 'Financement', icon: '🏦' },
    documents:   { label: 'Examen des documents', icon: '📑', extra: 7, extraLabel: 'avis au vendeur' },
    vente:       { label: "Vente d'une propriété de l'acheteur", icon: '🏠' },
    autre:       { label: 'Autre condition', icon: '📌' }
  };

  // ---------- données (local d'abord, puis Supabase via /api/transactions) ----------
  let txs = ls.get('mb_tx', {}), pending = new Set(ls.get('mb_tx_pending', []));
  const persist = () => { ls.set('mb_tx', txs); ls.set('mb_tx_pending', [...pending]); };
  const list = () => Object.values(txs).filter(t => !t.deleted);
  function save(t) { t.updatedAt = new Date().toISOString(); txs[t.id] = t; pending.add(t.id); persist(); flush(); render(); }
  let flushing = false;
  async function flush() {
    if (flushing || !pending.size) return; flushing = true;
    try {
      const ids = [...pending]; const items = ids.map(id => ({ id, data: txs[id], updatedAt: txs[id].updatedAt })).filter(i => i.data);
      const r = await fetch('/api/transactions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      if (r.ok) { ids.forEach(id => pending.delete(id)); persist(); }
    } catch (x) {}
    flushing = false;
  }
  async function pull() {
    try {
      const r = await fetch('/api/transactions', { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) return;
      const { items } = await r.json();
      (items || []).forEach(it => { const mine = txs[it.id], theirs = Object.assign({}, it.data, { id: it.id }); if (!mine || (!pending.has(it.id) && (theirs.updatedAt || '') >= (mine.updatedAt || ''))) txs[it.id] = theirs; });
      persist(); render(); flush();
    } catch (x) {}
  }

  // ---------- dates limites ----------
  function milestones(t) {
    const out = [], acc = t.acceptedAt; if (!acc || t.kind === 'revenu') return out;
    const hour = t.hour || '19:00';
    (t.conditions || []).forEach(c => {
      const ty = CTYPES[c.type] || CTYPES.autre, n = +c.days; if (!n && n !== 0) return;
      const name = c.type === 'autre' && c.label ? c.label : ty.label;
      if (c.type === 'inspection') {
        out.push({ key: c.id + ':a', cid: c.id, icon: ty.icon, label: `${name} — à faire (fin des ${n} jours)`, date: addD(acc, n), hour });
        const x = c.extra != null ? +c.extra : 4;
        out.push({ key: c.id + ':b', cid: c.id, icon: '⚠️', label: `${name} — DATE LIMITE avis au vendeur (${n} + ${x} jours)`, date: addD(acc, n + x), hour, legal: c.legalHour ? `avant ${hh(c.legalHour)} selon le formulaire` : '', main: true });
      } else if (c.type === 'documents') {
        const x = c.extra != null ? +c.extra : 7;
        out.push({ key: c.id + ':a', cid: c.id, icon: ty.icon, label: `${name} — documents à recevoir du vendeur (${n} jours)`, date: addD(acc, n), hour });
        out.push({ key: c.id + ':b', cid: c.id, icon: '⚠️', label: `${name} — DATE LIMITE avis au vendeur (${n} + ${x} jours)`, date: addD(acc, n + x), hour, main: true });
      } else {
        out.push({ key: c.id + ':a', cid: c.id, icon: '⚠️', label: `${name} — DATE LIMITE (${n} jours)`, date: addD(acc, n), hour, main: true });
      }
    });
    // tâches automatiques après l'acceptation
    if ((t.conditions || []).some(c => c.type === 'financement') && t.kind !== 'vente') out.push({ key: 'task:bank', icon: '📤', label: 'Envoyer les documents à la banque (financement) — au plus tard aujourd\'hui', date: addD(acc, 1), hour: '10:00', task: true });
    out.push({ key: 'task:ezmax', icon: '🗂️', label: 'Créer la transaction dans EzSign / EzMax — au plus tard aujourd\'hui', date: addD(acc, 2), hour: '10:00', task: true });
    if (t.deedAt) out.push({ key: 'deed', icon: '🖋️', label: 'Acte de vente chez le notaire (le ou avant)', date: t.deedAt, hour: t.deedHour || '', info: true });
    if (t.occupationAt) out.push({ key: 'occ', icon: '🔑', label: 'Occupation des lieux', date: t.occupationAt, hour: t.occupationHour || '', info: true });
    out.forEach(m => { const ev = (t.events || {})[m.key]; if (ev && ev.slot != null) m.placed = ev.slot; const c = (t.conditions || []).find(k => k.id === m.cid); m.closed = !!(c && (c.status === 'levee' || c.status === 'nulle')) || !!(t.done || {})[m.key]; const wd = new Date(m.date + 'T12:00:00').getDay(); m.weekend = wd === 0 || wd === 6; });
    return out.sort((a, b) => (a.date + (a.hour || '')).localeCompare(b.date + (b.hour || '')));
  }
  const KIND_L = { vente: 'Vente', achat: 'Achat', double: 'Vente + achat', location: 'Location', revenu: 'Autre revenu' };
  const kindL = (t) => KIND_L[t.kind] || 'Achat';
  const commOf = (t) => t.commAmount != null && t.commAmount !== '' ? +t.commAmount : (t.price && t.commissionPct ? t.price * t.commissionPct / 100 : 0);
  const commLine = (t) => t.commAmount != null && t.commAmount !== '' ? `<br>💰 Ta part : <b>${money(+t.commAmount)}</b> <span class="crm-muted">(montant fixe${t.commNote ? ' · ' + e(t.commNote) : ''})</span>` : t.commissionPct && t.price ? `<br>💰 Ta part : <b>${String(t.commissionPct).replace('.', ',')} %</b> × ${money(t.price)} = <b>${money(t.price * t.commissionPct / 100)}</b> <span class="crm-muted">(+ taxes)</span>` : '';
  function countdown(date) {
    const n = diffD(today(), date);
    if (n < 0) return { t: `dépassée (${-n} j)`, cls: 'past' };
    if (n === 0) return { t: "AUJOURD'HUI", cls: 'now' };
    if (n === 1) return { t: 'DEMAIN', cls: 'soon' };
    return { t: `dans ${n} j`, cls: n <= 3 ? 'soon' : '' };
  }

  // ---------- lecture de la promesse d'achat (formulaire OACIQ PA) ----------
  let pdfjs = null;
  function lib() {
    if (pdfjs) return pdfjs;
    pdfjs = new Promise((ok, ko) => {
      if (window.pdfjsLib) return ok(window.pdfjsLib);
      const s = document.createElement('script'); s.src = '/vendor/pdf3.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf3.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = () => { pdfjs = null; ko(new Error('pdf.js non chargé')); };
      document.head.appendChild(s);
    });
    return pdfjs;
  }
  async function readPdf(file) { return parsePA(await readLines(file)); }
  async function readLines(file) {
    const p = await lib();
    const doc = await p.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0, isEvalSupported: false }).promise;
    const lines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent(); const L = {};
      tc.items.forEach(i => { if (!i.str.trim()) return; const k = Math.round(i.transform[5] / 3); (L[k] = L[k] || []).push({ s: i.str.trim(), x: i.transform[4] }); });
      Object.keys(L).sort((a, b) => b - a).forEach(k => { const it = L[k].sort((a, b) => a.x - b.x); lines.push({ t: it.map(i => i.s).join(' | '), it }); });
    }
    try { doc.destroy(); } catch (x) {}
    return lines;
  }
  const MOIS = { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 };
  function frDate(s) {
    const m = String(s || '').replace(/\s*\|\s*/g, ' ').match(/(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i);
    if (m) return `${m[3]}-${String(MOIS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const i = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return i ? i[0] : '';
  }
  function parsePA(lines) {
    const T = lines.map(l => l.t);
    const find = (rx, from = 0) => { for (let i = from; i < T.length; i++) if (rx.test(T[i])) return i; return -1; };
    const numNear = (i) => {
      const m = T[i].match(/dans les\s*\|?\s*(\d{1,3})\s*\|?\s*jours/); if (m) return +m[1];
      for (let k = i - 1; k >= Math.max(0, i - 2); k--) { const mm = T[k].match(/^(\d{1,3})$/); if (mm) return +mm[1]; }
      return null;
    };
    const clean = (s) => String(s || '').replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const r = { conditions: [], warnings: [], found: {} };
    if (!/PROMESSE D.ACHAT/i.test(T.slice(0, 15).join(' '))) r.warnings.push("Ce PDF ne ressemble pas à une promesse d'achat de l'OACIQ : vérifie bien chaque champ.");
    // parties
    const ip = find(/IDENTIFICATION DES PARTIES/);
    const nameOf = (it, left) => clean(it.filter(i => left ? i.x < 300 : i.x >= 300).map(i => i.s).join(' '));
    if (ip >= 0 && lines[ip + 1]) { r.buyer1 = nameOf(lines[ip + 1].it, true); r.seller1 = nameOf(lines[ip + 1].it, false); }
    const lab = find(/ACHETEUR 1 ET/, ip); const soc = lab >= 0 ? find(/^D.UNE SOCIÉTÉ\)/, lab) : -1;
    if (soc >= 0 && lines[soc + 1] && !/^NOM,/.test(T[soc + 1])) r.buyer2 = nameOf(lines[soc + 1].it, true);
    const isName = (s) => s && /^[A-Za-zÀ-ÿ'’\-. ]{3,}$/.test(s) && s.split(' ').length <= 5;
    ['buyer1', 'buyer2', 'seller1'].forEach(k => { if (!isName(r[k])) delete r[k]; });
    // courtier : si Julien est à la clause 2.1 (courtier de l'acheteur) → dossier d'achat
    const c21 = find(/^2\.1/); const broker = c21 >= 0 ? clean(T.slice(c21, c21 + 2).join(' ')) : '';
    r.kind = /Rock/i.test(broker) ? 'achat' : 'vente';
    // immeuble
    const ad = find(/^NUMÉRO \| RUE \| VILLE/); if (ad > 0) r.address = clean(T[ad - 1]);
    const pt = T.map(t => t.match(/PRIX TOTAL \| ([\d   ]+),\d\d/)).find(Boolean) || T.map(t => t.match(/^(\d{1,3}(?: \| \d{3})+),\d\d$/)).find(Boolean);
    if (pt) r.price = +pt[1].replace(/[^\d]/g, '');
    // financement (6.2)
    const fi = find(/ENGAGEMENT.*dans les/); const fd = fi >= 0 ? numNear(fi) : null;
    if (fd != null) r.conditions.push({ type: 'financement', days: fd });
    // inspection (8.1)
    const ii = find(/dans les.*jours suivant l.acceptation de la présente promesse d.achat\. Si cette inspection/);
    const idays = ii >= 0 ? numNear(ii) : null;
    if (idays != null) {
      const nt = T.slice(ii, ii + 4).join(' ').match(/la\s+(\d{1,2})\s*\|?\s*journée/); const ht = T.slice(ii, ii + 4).join(' ').match(/avant\s+(\d{1,2})\s*h/);
      r.conditions.push({ type: 'inspection', days: idays, extra: nt ? +nt[1] : 4, legalHour: ht ? String(ht[1]).padStart(2, '0') + ':00' : '' });
    }
    // examen des documents (9.1)
    const di = find(/copie des documents mentionnés ci-dessus dans les/);
    const dd = di >= 0 ? numNear(di) : null;
    if (dd != null) {
      const s91 = find(/^9\.1/); const docs = s91 >= 0 ? clean(T.slice(s91 + 1, di).filter(t => !/^\d{1,3}$/.test(t)).join(' ')) : '';
      const nt = T.slice(di, di + 4).join(' ').match(/dans les \w+ \((\d+)\) jours suivant l.expiration/);
      r.conditions.push({ type: 'documents', days: dd, extra: nt ? +nt[1] : 7, label: docs.slice(0, 300) });
    }
    // vente d'une propriété de l'acheteur (annexe) — si mentionnée
    const vi = find(/conditionnelle à la vente/i); if (vi >= 0) { const n = numNear(vi); r.conditions.push({ type: 'vente', days: n || '' }); }
    // acte de vente / occupation
    const de = find(/le ou avant le/); if (de > 0) r.deedAt = frDate(T[de - 1]) || frDate(T[de]);
    const oc = find(/OCCUPATION/); if (oc >= 0) { for (let k = oc + 1; k < oc + 4 && k < T.length; k++) { const d = frDate(T[k]); if (d) { r.occupationAt = d; const h = T[k].match(/\d{4}\s*\|\s*(\d{1,2})\s*\|\s*(\d{2})/); if (h) r.occupationHour = h[1].padStart(2, '0') + ':' + h[2]; break; } } }
    // irrévocabilité (date limite d'acceptation) — sert de date d'acceptation proposée, à confirmer
    const ir = find(/s.oblige irrévocablement/); if (ir >= 0) { for (let k = ir - 2; k <= ir; k++) { const d = frDate(T[k]); if (d) { r.irrevocableAt = d; break; } } }
    // date d'acceptation signée (si lisible dans le PDF)
    const ac = T.findIndex(t => /ACCEPTER/.test(t));
    if (ac >= 0) for (let k = ac + 1; k < ac + 6 && k < T.length; k++) { const d = frDate(T[k]); if (d) { r.acceptedAt = d; r.found.accepted = true; break; } }
    if (!r.acceptedAt && r.irrevocableAt) { r.acceptedAt = r.irrevocableAt; r.warnings.push(`La date d'acceptation n'est pas lisible dans le PDF : j'ai mis la date limite d'irrévocabilité (${fmtD(r.irrevocableAt, true)}). Vérifie-la.`); }
    // autres conditions (12)
    const a12 = find(/^12\. \| AUTRES DÉCLARATIONS/), a13 = find(/^13\. \| ANNEXES/);
    const FOOT = /^(L.OACIQ A POUR|Généré par|\d+\/\d+ \| ©|INFO OACIQ|\d{4,6}$|PA$|\(V\d+|\d{2}\/\d{4}\)|12\.1$)/;
    if (a12 >= 0 && a13 > a12) r.otherText = clean(T.slice(a12 + 1, a13).filter(t => !FOOT.test(t)).join(' ').replace(/\b12\.1\b/, ''));
    if (!r.conditions.length) r.warnings.push("Aucune condition n'a été trouvée automatiquement : ajoute-les à la main.");
    return r;
  }

  // ---------- Google Agenda ----------
  async function gReq(method, path, body) {
    if (typeof accessToken === 'undefined') return null;
    if (!accessToken && typeof getServerToken === 'function') await getServerToken();
    if (!accessToken) return null;
    const go = () => fetch('https://www.googleapis.com/calendar/v3/' + path, { method, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let r = await go();
    if (r.status === 401 && typeof getServerToken === 'function' && await getServerToken()) r = await go();
    if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error('Google ' + r.status);
    return r.status === 204 ? {} : r.json().catch(() => ({}));
  }
  function calId() {
    const cals = (typeof writableCals !== 'undefined' && writableCals.length) ? writableCals : [{ id: 'primary', primary: true }];
    try { const last = JSON.parse(localStorage.getItem('mb_lastcal')); if (last && cals.some(x => x.id === last)) return last; } catch (x) {}
    return (cals.find(x => x.primary) || cals[0]).id;
  }
  function evBody(t, m) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const where = t.address || 'dossier';
    const desc = [`${t.kind === 'vente' ? 'Dossier de vente' : "Dossier d'achat"} — ${where}`, t.clients ? 'Clients : ' + t.clients : '', `Acceptée le ${fmtD(t.acceptedAt, true)}`, m.legal ? 'Limite légale : ' + m.legal : '', 'Créé par Motherboard'].filter(Boolean).join('\n');
    const priv = { mbType: m.info ? 'reunion' : 'urgent', mbTx: t.id, mbKey: m.key };
    if (m.info && !m.hour) return { summary: `${m.icon} ${m.label} — ${where}`, description: desc, start: { date: m.date }, end: { date: addD(m.date, 1) }, extendedProperties: { private: priv }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 * 60 }] } };
    // dates limites : placées le matin (9 h 30 – 10 h) du jour limite, avec l'heure limite dans le titre ; alertes la veille 9 h 30 et le matin même 9 h 30
    // tâches : 10 h, alerte à l'heure · info (occupation) : à son heure, alerte la veille
    const deadline = !m.info && !m.task;
    const [h, mi] = m.slot != null ? [Math.floor(m.slot / 60), m.slot % 60] : deadline ? [9, 30] : (m.hour || '10:00').split(':').map(Number);
    const st = new Date(m.date + 'T00:00:00'); st.setHours(h, mi || 0, 0, 0);
    const en = new Date(st.getTime() + 30 * 60000);
    const rem = deadline ? [{ method: 'popup', minutes: 24 * 60 }, { method: 'popup', minutes: 0 }] : m.task ? [{ method: 'popup', minutes: 0 }] : [{ method: 'popup', minutes: 24 * 60 }];
    return {
      summary: `${m.info || m.task ? m.icon : '⚠️'} ${m.label.replace(/^⚠️\s*/, '')}${deadline ? ` (limite ${hh(m.hour)})` : ''} — ${where}`, description: desc, colorId: m.info ? '9' : m.task ? '6' : '11',
      start: { dateTime: st.toISOString(), timeZone: tz }, end: { dateTime: en.toISOString(), timeZone: tz },
      extendedProperties: { private: priv }, reminders: { useDefault: false, overrides: rem }
    };
  }
  // ---------- placement des tâches : entre 9 h et 17 h, sans chevaucher un rendez-vous déjà pris ----------
  const WIN = [9 * 60, 17 * 60], DUR = 30;
  let calsCache = null;
  async function readCals() {
    if (calsCache) return calsCache;
    try { const r = await gReq('GET', 'users/me/calendarList?minAccessRole=reader'); calsCache = ((r && r.items) || []).filter(c => !/#(holiday|contacts)@group\.v\.calendar\.google\.com$/.test(c.id) && c.selected !== false).map(c => c.id); }
    catch (x) { calsCache = []; }
    if (!calsCache.length) calsCache = ['primary'];
    setTimeout(() => { calsCache = null; }, 60000);
    return calsCache;
  }
  async function busyOn(day) {
    const t0 = new Date(day + 'T00:00:00'), t1 = new Date(day + 'T23:59:59'), out = [];
    const toMin = (d) => Math.max(0, Math.min(24 * 60, Math.round((d - t0) / 60000)));
    for (const id of await readCals()) {
      try {
        const r = await gReq('GET', `calendars/${encodeURIComponent(id)}/events?singleEvents=true&maxResults=100&timeMin=${encodeURIComponent(t0.toISOString())}&timeMax=${encodeURIComponent(t1.toISOString())}`);
        ((r && r.items) || []).forEach(ev => {
          if (!ev.start || !ev.start.dateTime || ev.status === 'cancelled' || ev.transparency === 'transparent') return;
          const p = (ev.extendedProperties && ev.extendedProperties.private) || {};
          if (p.mbTx) return;                                   // nos propres rappels de transaction : on les replace
          if ((ev.attendees || []).some(a => a.self && a.responseStatus === 'declined')) return;
          out.push([toMin(new Date(ev.start.dateTime)), toMin(new Date(ev.end.dateTime))]);
        });
      } catch (x) {}
    }
    return out;
  }
  function freeSlot(busy, pref) {
    const free = (st) => busy.every(([a, b]) => st + DUR <= a || st >= b);
    pref = Math.min(Math.max(pref, WIN[0]), WIN[1] - DUR);
    for (let st = pref; st <= WIN[1] - DUR; st += 15) if (free(st)) return st;
    for (let st = pref - 15; st >= WIN[0]; st -= 15) if (free(st)) return st;
    return pref;   // journée pleine : on garde l'heure prévue
  }
  async function syncCalendar(t) {
    const old = t.events || {}; const next = {}; let ok = 0, bad = 0;
    const ms = milestones(t).filter(m => !m.closed && m.date >= today());
    const busyCache = {};
    for (const m of ms) {
      if (m.info) continue;
      const day = m.date; if (!busyCache[day]) busyCache[day] = await busyOn(day);
      const pref = m.task ? 10 * 60 : 9 * 60 + 30;
      m.slot = freeSlot(busyCache[day], pref);
      busyCache[day].push([m.slot, m.slot + DUR]);            // deux tâches du même jour ne se chevauchent pas
    }
    for (const m of ms) {
      try {
        const body = evBody(t, m), prev = old[m.key];
        let res = null;
        if (prev) res = await gReq('PUT', `calendars/${encodeURIComponent(prev.cal)}/events/${encodeURIComponent(prev.id)}`, body);
        if (!res || !res.id) res = await gReq('POST', `calendars/${encodeURIComponent(calId())}/events`, body);
        if (res && res.id) { next[m.key] = { cal: prev && res.id === prev.id ? prev.cal : calId(), id: res.id, slot: m.slot }; ok++; } else bad++;
      } catch (x) { bad++; }
    }
    for (const k of Object.keys(old)) if (!next[k]) { try { await gReq('DELETE', `calendars/${encodeURIComponent(old[k].cal)}/events/${encodeURIComponent(old[k].id)}`); } catch (x) {} }
    t.events = next; save(t);
    if (typeof ensureLoaded === 'function') try { ensureLoaded(true); } catch (x) {}
    return { ok, bad };
  }

  // ---------- affichage ----------
  function modal() {
    let m = document.getElementById('tx-modal');
    if (!m) { m = document.createElement('div'); m.id = 'tx-modal'; m.className = 'modal'; m.innerHTML = '<div class="sheet tx-sheet"></div>'; document.body.appendChild(m); m.addEventListener('click', ev => { if (ev.target === m) close(); }); }
    return m;
  }
  function close() { const m = document.getElementById('tx-modal'); if (m) m.classList.remove('open'); }
  function upcoming(limitDays) {
    const out = [];
    list().filter(t => !['fermee', 'annulee', 'conclue'].includes(t.status)).forEach(t => milestones(t).forEach(m => { if (!m.closed && (limitDays == null || diffD(today(), m.date) <= limitDays)) out.push(Object.assign({ t }, m)); }));
    return out.sort((a, b) => (a.date + (a.hour || '')).localeCompare(b.date + (b.hour || '')));
  }
  function msRow(m, withAddr) {
    const cd = countdown(m.date);
    return `<div class="tx-ms ${m.info ? 'info' : ''}${m.task ? ' task' : ''} ${cd.cls}${m.closed ? ' closed' : ''}">
      <div class="tx-ms-d"><b>${fmtD(m.date)}</b><span>${m.task ? 'tâche · ' + (m.placed != null ? hh(Math.floor(m.placed / 60) + ':' + String(m.placed % 60).padStart(2, '0')) : hh(m.hour)) : m.info ? (m.hour ? hh(m.hour) : 'journée') : 'limite ' + hh(m.hour)}</span></div>
      <div class="tx-ms-b"><div>${m.icon} ${e(m.label)}</div>${withAddr ? `<div class="crm-muted">${e(m.t.address || '')}${m.t.clients ? ' · ' + e(m.t.clients) : ''}</div>` : ''}${m.legal ? `<div class="crm-muted">⚖️ ${e(m.legal)}</div>` : ''}${m.weekend && !m.info ? '<div class="tx-we">⚠️ tombe un week-end — vérifie le délai</div>' : ''}</div>
      <div class="tx-ms-c">${m.closed ? '✓' : `<span class="tx-cd">${cd.t}</span>`}${!m.info && !m.closed ? `<button onclick="event.stopPropagation();TX.done('${m.t.id}','${m.key}')" title="Fait">✓</button>` : ''}</div>
    </div>`;
  }
  function render() {
    const root = document.getElementById('transactions'); if (!root) return;
    const all = list().sort((a, b) => (b.acceptedAt || b.deedAt || '').localeCompare(a.acceptedAt || a.deedAt || ''));
    const up = upcoming(null).filter(m => !m.info || diffD(today(), m.date) <= 14).filter(m => m.date >= addD(today(), -3));
    root.innerHTML = `
      <input type="file" id="tx-file" accept="application/pdf,.pdf" style="display:none" onchange="TX.importFile(this.files[0]);this.value=''">
      <div class="tx-top"><b class="pr-title">Transactions</b><span style="flex:1"></span>
        <button class="crm-add" onclick="document.getElementById('tx-file').click()">📥 Importer une promesse d'achat (PDF)</button>
        <button class="crm-add tx-new" onclick="TX.edit()">+ Dossier</button></div>
      ${up.length ? `<div class="section-title">⏰ Prochaines échéances</div><div class="tx-list">${up.slice(0, 12).map(m => msRow(m, true)).join('')}</div>` : ''}
      <div class="section-title">Dossiers (${all.length})</div>
      ${all.length ? all.map(card).join('') : `<div class="crm-empty"><b>Aucun dossier pour l'instant.</b><br>Importe le PDF de ta promesse d'achat acceptée : l'app lit les conditions et calcule les dates limites.<br><button class="cta-btn" onclick="document.getElementById('tx-file').click()">📥 Importer une promesse d'achat</button></div>`}
      <div style="height:90px"></div>`;
  }
  function card(t) {
    const ms = milestones(t).filter(m => !m.info), open = ms.filter(m => !m.closed), next = open[0];
    const conds = (t.conditions || []).map(c => { const ty = CTYPES[c.type] || CTYPES.autre; return `<span class="tx-cond ${c.status || ''}">${ty.icon} ${e(c.type === 'autre' && c.label ? c.label : ty.label)}${c.status === 'levee' ? ' ✓' : c.status === 'nulle' ? ' ✗' : ''}</span>`; }).join('');
    return `<div class="tx-card" onclick="TX.open('${t.id}')">
      <div class="tx-l1"><span class="tx-kind ${t.kind}">${kindL(t)}</span><b>${e(t.address || 'Dossier sans adresse')}</b><span class="tx-price">${t.price ? money(t.price) : ''}</span></div>
      <div class="crm-muted">${t.clients ? '👤 ' + e(t.clients) + ' · ' : ''}${t.acceptedAt ? 'acceptée le ' + fmtD(t.acceptedAt) : ''}${t.deedAt ? (t.acceptedAt ? ' · ' : '') + (t.kind === 'revenu' ? '📅 ' : '🖋️ notaire ') + fmtD(t.deedAt) : ''}${t.status === 'conclue' ? ' · ✅ conclue' : ''}${commOf(t) ? ' · 💰 ' + money(commOf(t)) : ''}</div>
      ${t.status === 'conclue' && !(t.conditions || []).length ? '' : `<div class="tx-conds">${conds || '<span class="crm-muted">Aucune condition</span>'}</div>`}
      ${next ? `<div class="tx-next ${countdown(next.date).cls}">⏰ Prochaine : ${e(next.label)} — <b>${fmtD(next.date)} ${hh(next.hour)}</b> (${countdown(next.date).t})</div>` : ms.length ? '<div class="tx-next ok">✅ Toutes les conditions sont réglées</div>' : ''}
    </div>`;
  }
  function open(id) {
    const t = txs[id]; if (!t) return;
    const box = modal().querySelector('.sheet');
    const ms = milestones(t);
    box.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="TX.close()">✕</button><b>${kindL(t)} · ${e(t.address || '')}</b><span class="sheet-acts"><button class="sheet-trash" onclick="TX.del('${t.id}')" title="Supprimer">🗑</button><button class="sheet-save" onclick="TX.edit('${t.id}')">Modifier</button></span></div>
      <div class="tx-sum">${t.price ? money(t.price) : ''}${t.centris ? ' · Centris ' + e(t.centris) : ''}${t.clients ? ' · 👤 ' + e(t.clients) : ''}${t.otherParty ? ` · ${t.kind === 'vente' ? 'Acheteur' : 'Vendeur'} : ${e(t.otherParty)}` : ''}${t.acceptedAt ? `<br>Acceptée le <b>${fmtD(t.acceptedAt, true)}</b> · jour 1 = ${fmtD(addD(t.acceptedAt, 1))}` : ''}${t.deedAt && (t.status === 'conclue' || !t.acceptedAt) ? `<br>${t.kind === 'revenu' ? 'Reçu le' : 'Notarié le'} <b>${fmtD(t.deedAt, true)}</b>` : ''}${commLine(t)}${t.memo ? `<br><span class="crm-muted">${e(t.memo)}</span>` : ''}${t.listingId && window.LST ? `<br><button class="tx-link" onclick="TX.close();LST.open('${t.listingId}')">🏷️ Voir l'inscription</button>` : ''}</div>
      <div class="f-label">Conditions</div>
      ${(t.conditions || []).map(c => { const ty = CTYPES[c.type] || CTYPES.autre; return `<div class="tx-crow"><div>${ty.icon} <b>${e(c.type === 'autre' && c.label ? c.label : ty.label)}</b> · ${c.days} jours${c.extra ? ' + ' + c.extra : ''}${c.type === 'documents' && c.label ? `<div class="crm-muted">${e(c.label)}</div>` : ''}</div>
        <div class="chips">${[['', 'En cours'], ['levee', '✓ Levée / réalisée'], ['nulle', '✗ Promesse nulle']].map(([k, l]) => `<button class="${(c.status || '') === k ? 'on' : ''}" onclick="TX.cstatus('${t.id}','${c.id}','${k}')">${l}</button>`).join('')}</div></div>`; }).join('') || '<div class="crm-muted">Aucune condition.</div>'}
      <div class="f-label">Dates limites</div>
      <div class="tx-list">${ms.map(m => msRow(Object.assign({ t }, m), false)).join('')}</div>
      ${t.otherText ? `<div class="f-label">Autres déclarations et conditions (12)</div><div class="tx-note">${e(t.otherText)}</div>` : ''}
      ${t.notes ? `<div class="f-label">Notes</div><div class="tx-note">${e(t.notes)}</div>` : ''}
      <div class="tx-actions">${t.hasPdf ? `<button onclick="TX.pdf('${t.id}')">📄 Voir la promesse d'achat</button>` : ''}<button onclick="TX.resync('${t.id}')">📅 Remettre les rappels dans l'agenda</button>${t.contactId && window.CRM ? `<button onclick="TX.close();CRM.open('${t.contactId}')">👤 Fiche du client</button>` : ''}</div>
      <div class="crm-muted" style="margin-top:10px">${Object.keys(t.events || {}).length ? `📅 ${Object.keys(t.events).length} rappel(s) dans ton agenda Google (en rouge, alertes la veille 9 h et le matin 9 h).` : 'Aucun rappel dans ton agenda pour ce dossier.'}</div>`;
    modal().classList.add('open'); box.scrollTop = 0;
  }

  // ---------- formulaire (nouveau, modification, vérification après import) ----------
  let draft = null;
  function edit(id, fromImport) {
    draft = id ? JSON.parse(JSON.stringify(txs[id])) : (fromImport || { id: uuid(), kind: 'achat', acceptedAt: today(), hour: '19:00', conditions: [], createdAt: new Date().toISOString() });
    renderForm(!!fromImport);
    modal().classList.add('open'); modal().querySelector('.sheet').scrollTop = 0;
  }
  function contactOpts() {
    if (!window.CRM || !CRM._all) return '';
    return Object.values(CRM._all()).filter(c => !c.deleted && (c.type === 'acheteur' || c.type === 'vendeur' || c.isContact || c.suivi)).map(c => `<option value="${c.id}" ${draft.contactId === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('');
  }
  function renderForm(imp) {
    const d = draft, box = modal().querySelector('.sheet');
    const ms = milestones(d);
    box.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="TX.close()">✕</button><b>${imp ? 'Vérifie le dossier importé' : txs[d.id] ? 'Modifier le dossier' : 'Nouveau dossier'}</b><button class="sheet-save" onclick="TX.saveForm()">Enregistrer</button></div>
      ${(d._warn || []).map(w => `<div class="tx-warn">⚠️ ${e(w)}</div>`).join('')}
      ${imp ? '<div class="tx-info">Vérifie chaque date avec ta promesse d\'achat avant d\'enregistrer : une date limite manquée a des conséquences légales.</div>' : ''}
      <div class="chips" style="margin-top:12px">${[['achat', "🛒 Dossier d'achat"], ['vente', '🏷️ Dossier de vente'], ['double', '🔁 Vente + achat'], ['location', '🔑 Location'], ['revenu', '💵 Autre revenu']].map(([k, l]) => `<button class="${d.kind === k ? 'on' : ''}" onclick="TX.f('kind','${k}')">${l}</button>`).join('')}</div>
      <label class="f-block">Adresse de l'immeuble<input value="${e(d.address || '')}" oninput="TX.f('address',this.value,1)"></label>
      <div class="f-row"><label style="flex:1">Prix<input inputmode="numeric" value="${d.price ? Math.round(d.price).toLocaleString('fr-CA') : ''}" oninput="TX.f('price',+this.value.replace(/[^\\d]/g,''),1)"></label>
        <label style="flex:1">${d.kind === 'vente' ? 'Acheteur' : 'Vendeur'}<input value="${e(d.otherParty || '')}" oninput="TX.f('otherParty',this.value,1)"></label></div>
      <div class="f-row"><label style="flex:1">Ma commission (%)<input inputmode="decimal" value="${d.commissionPct != null && d.commissionPct !== '' ? String(d.commissionPct).replace('.', ',') : ''}" placeholder="ex. 3,5" oninput="TX.f('commissionPct',this.value?+this.value.replace(',','.'):null,1)">${d.commTotalPct && d.collabPct ? `<span class="f-hint">Contrat : ${String(d.commTotalPct).replace('.', ',')} % − ${String(d.collabPct).replace('.', ',')} % au collaborateur. <a onclick="TX.f('commissionPct',${d.commTotalPct})">Pas de collaborateur → ${String(d.commTotalPct).replace('.', ',')} %</a></span>` : '<span class="f-hint">Ta part seulement (sans la part du collaborateur)</span>'}</label>
        <label style="flex:1">ou montant fixe ($)<input inputmode="decimal" value="${d.commAmount != null && d.commAmount !== '' ? String(d.commAmount).replace('.', ',') : ''}" placeholder="ex. 1 000" oninput="TX.f('commAmount',this.value?+this.value.replace(/\\s/g,'').replace(',','.'):null,1)"><span class="f-hint">Remplace le %</span></label>
        <label style="flex:1">Statut<select onchange="TX.f('status',this.value,1)">${[['active', 'En cours'], ['conclue', 'Conclue (notaire signé)'], ['annulee', 'Annulée']].map(([k, l]) => `<option value="${k}" ${(d.status || 'active') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label class="f-block">Mes clients<input value="${e(d.clients || '')}" placeholder="ex. Dany Bouchard et Tamar Alexanian" oninput="TX.f('clients',this.value,1)"></label>
      <label class="f-block">Lier à la fiche contact<select onchange="TX.f('contactId',this.value,1)"><option value="">—</option>${contactOpts()}</select></label>
      <div class="f-row"><label style="flex:1.4">Date d'acceptation<input type="date" value="${d.acceptedAt || ''}" onchange="TX.f('acceptedAt',this.value)"></label>
        <label style="flex:1">Heure limite<input type="time" value="${d.hour || '19:00'}" onchange="TX.f('hour',this.value)"></label></div>
      <div class="crm-muted" style="margin-top:4px">Jour 1 = ${d.acceptedAt ? fmtD(addD(d.acceptedAt, 1), true) : '—'}</div>
      <div class="f-label">Conditions</div>
      ${(d.conditions || []).map((c, i) => `<div class="tx-cedit">
        <select onchange="TX.cf(${i},'type',this.value)">${Object.entries(CTYPES).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select>
        <label>jours<input type="number" min="0" value="${c.days != null ? c.days : ''}" oninput="TX.cf(${i},'days',this.value===''?null:+this.value,1)" onchange="TX.cf(${i},'days',this.value===''?null:+this.value)"></label>
        ${CTYPES[c.type] && CTYPES[c.type].extra ? `<label>+ jours (avis)<input type="number" min="0" value="${c.extra != null ? c.extra : CTYPES[c.type].extra}" onchange="TX.cf(${i},'extra',+this.value)"></label>` : ''}
        ${c.type === 'autre' || c.type === 'documents' ? `<input class="tx-clabel" placeholder="${c.type === 'documents' ? 'Documents à examiner' : 'Nom de la condition'}" value="${e(c.label || '')}" oninput="TX.cf(${i},'label',this.value,1)">` : ''}
        <button class="tx-cdel" onclick="TX.cdel(${i})" title="Retirer">✕</button></div>`).join('')}
      <div class="chips" style="margin-top:6px">${Object.entries(CTYPES).map(([k, v]) => `<button onclick="TX.cadd('${k}')">+ ${v.icon} ${v.label}</button>`).join('')}</div>
      <div class="f-row"><label style="flex:1">Acte de vente (le ou avant)<input type="date" value="${d.deedAt || ''}" onchange="TX.f('deedAt',this.value)"></label>
        <label style="flex:1">Occupation<input type="date" value="${d.occupationAt || ''}" onchange="TX.f('occupationAt',this.value)"></label>
        <label style="flex:.7">à<input type="time" value="${d.occupationHour || ''}" onchange="TX.f('occupationHour',this.value)"></label></div>
      <div class="f-label">Dates limites calculées</div>
      <div class="tx-list" id="tx-preview">${ms.length ? ms.map(m => msRow(Object.assign({ t: d }, m), false)).join('') : '<div class="crm-muted">Entre la date d\'acceptation et les jours de chaque condition.</div>'}</div>
      ${d.otherText != null ? `<label class="f-block">Autres déclarations et conditions (12)<textarea rows="3" oninput="TX.f('otherText',this.value,1)">${e(d.otherText || '')}</textarea></label>` : ''}
      <label class="f-block">Notes<textarea rows="2" oninput="TX.f('notes',this.value,1)">${e(d.notes || '')}</textarea></label>
      <label class="f-check" style="margin-top:12px"><input type="checkbox" id="tx-cal" checked> Créer les rappels urgents dans mon agenda Google (en rouge, alertes la veille 9 h et le matin 9 h)</label>
      <div style="height:20px"></div>`;
  }
  function refreshPreview() { const el = document.getElementById('tx-preview'); if (el) { const ms = milestones(draft); el.innerHTML = ms.map(m => msRow(Object.assign({ t: draft }, m), false)).join(''); } }
  function f(k, v, quiet) { draft[k] = v; if (quiet) refreshPreview(); else renderForm(!!draft._imp); }
  function cf(i, k, v, quiet) { draft.conditions[i][k] = v; if (k === 'type') { const ty = CTYPES[v]; draft.conditions[i].extra = ty && ty.extra ? ty.extra : undefined; } if (quiet) refreshPreview(); else renderForm(!!draft._imp); }
  function cadd(type) { draft.conditions.push({ id: uuid(), type, days: null, extra: CTYPES[type].extra }); renderForm(!!draft._imp); }
  function cdel(i) { draft.conditions.splice(i, 1); renderForm(!!draft._imp); }
  async function saveForm() {
    const d = draft; if (!d.acceptedAt) { toastMsg("Entre la date d'acceptation."); return; }
    if ((d.conditions || []).some(c => c.days == null || c.days === '')) { toastMsg('Il manque le nombre de jours pour une condition.'); return; }
    const wantCal = document.getElementById('tx-cal') && document.getElementById('tx-cal').checked;
    const file = d._file; delete d._file; delete d._warn; delete d._imp;
    d.status = d.status || 'active'; d.evv = 3;
    save(d);
    if (file) uploadPdf(d, file);
    if (d.listingId && window.LST && LST.linkTx) LST.linkTx(d.listingId, d);
    if (d.contactId && d.deedAt && window.CRM && CRM.setClosing) CRM.setClosing(d.contactId, d.deedAt);
    // fiche client : passe à l'étape « Conditions »
    if (d.contactId && window.CRM) { const c = CRM._all()[d.contactId]; if (c && !c.deleted) { const st = d.kind === 'vente' ? 'Offre acceptée' : 'Conditions'; if (c.stage !== st && !['Notaire', 'Client passé', 'Vendu / Notaire'].includes(c.stage)) { c.stage = st; } c.notes = c.notes || []; c.notes.push({ id: uuid(), at: new Date().toISOString(), text: `🤝 Promesse d'achat acceptée le ${fmtD(d.acceptedAt, true)} — ${d.address || ''}` }); CRM.upsert(c); } }
    close();
    if (wantCal) {
      toastMsg('📅 Création des rappels dans ton agenda…');
      const r = await syncCalendar(d);
      toastMsg(r.bad ? `⚠️ ${r.ok} rappel(s) créé(s), ${r.bad} en erreur — vérifie ta connexion Google` : `✅ Dossier enregistré · ${r.ok} rappel(s) urgents dans ton agenda`, 7000);
    } else toastMsg('✅ Dossier enregistré');
    render();
  }

  // ---------- actions ----------
  async function importFile(file, extra) {
    if (!file) return;
    toastMsg("📄 Lecture de la promesse d'achat…");
    try {
      const r = await readPdf(file);
      const d = { id: uuid(), kind: r.kind, address: r.address || '', price: r.price || 0, acceptedAt: r.acceptedAt || today(), hour: '19:00',
        clients: r.kind === 'achat' ? [r.buyer1, r.buyer2].filter(Boolean).join(' et ') : r.seller1 || '', otherParty: r.kind === 'achat' ? r.seller1 || '' : [r.buyer1, r.buyer2].filter(Boolean).join(' et '),
        conditions: r.conditions.map(c => Object.assign({ id: uuid() }, c)), deedAt: r.deedAt || '', occupationAt: r.occupationAt || '', occupationHour: r.occupationHour || '',
        otherText: r.otherText || '', createdAt: new Date().toISOString(), _warn: r.warnings, _imp: true, _file: file, fileName: file.name };
      if (extra) { Object.assign(d, extra); if (extra.kind === 'vente' && !r.found.kindSure) { d.kind = 'vente'; d.clients = extra.clients || d.clients; d.otherParty = [r.buyer1, r.buyer2].filter(Boolean).join(' et ') || d.otherParty; } }
      // lien automatique avec la fiche contact
      if (!d.contactId && window.CRM && CRM._all) {
        const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
        const names = (r.kind === 'achat' ? [r.buyer1, r.buyer2] : [r.seller1]).filter(Boolean).map(norm);
        const hit = Object.values(CRM._all()).find(c => !c.deleted && names.some(n => n && (norm(c.name) === n || (norm(c.name).length > 5 && n.includes(norm(c.name))) || (n.length > 5 && norm(c.name).includes(n)))));
        if (hit) d.contactId = hit.id;
      }
      edit(null, d);
    } catch (x) {
      toastMsg("⚠️ Impossible de lire ce PDF (" + (x.message || 'erreur') + "). Tu peux créer le dossier à la main avec « + Dossier ».", 8000);
    }
  }
  async function uploadPdf(t, file) {
    try {
      const r = await fetch('/api/pdf?id=' + t.id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf' }, body: file });
      if (r.ok) { t.hasPdf = true; save(t); }
    } catch (x) {}
  }
  async function pdf(id) {
    const w = window.open('', '_blank');
    try { const r = await fetch('/api/pdf?id=' + id, { credentials: 'same-origin' }); if (!r.ok) throw 0; const u = URL.createObjectURL(await r.blob()); if (w) w.location = u; else location.href = u; }
    catch (x) { if (w) w.close(); toastMsg("PDF introuvable."); }
  }
  async function cstatus(id, cid, st) {
    const t = txs[id]; const c = (t.conditions || []).find(k => k.id === cid); if (!c) return;
    c.status = st || undefined; c.statusAt = new Date().toISOString(); save(t); open(id);
    const r = await syncCalendar(t); open(id);
    toastMsg(st === 'levee' ? `✓ Condition levée — rappels retirés de l'agenda` : st === 'nulle' ? '✗ Noté : promesse nulle pour cette condition' : 'Condition remise en cours');
  }
  async function done(id, key) {
    const t = txs[id]; if (!t) return; t.done = t.done || {}; t.done[key] = new Date().toISOString(); save(t);
    if (document.getElementById('tx-modal') && document.getElementById('tx-modal').classList.contains('open')) open(id);
    await syncCalendar(t);
    toastMsg('✓ Échéance marquée faite');
    jourBox();
  }
  async function resync(id) { const t = txs[id]; toastMsg('📅 Mise à jour de l\'agenda…'); const r = await syncCalendar(t); open(id); toastMsg(r.bad ? `⚠️ ${r.bad} rappel(s) en erreur — connecte Google` : `✅ ${r.ok} rappel(s) à jour dans ton agenda`); }
  function del(id) { if (txs[id]) confirmDel(id); }
  function confirmDel(id) {
    const box = modal().querySelector('.sheet');
    const el = document.createElement('div'); el.className = 'crm-del'; el.innerHTML = `Supprimer ce dossier et ses rappels ? <button class="danger" onclick="TX.doDel('${id}')">Oui, supprimer</button><button onclick="TX.open('${id}')">Annuler</button>`;
    box.appendChild(el); el.scrollIntoView({ behavior: 'smooth' }); return false;
  }
  async function doDel(id) {
    const t = txs[id]; if (!t) return; const evs = t.events || {};
    t.deleted = true; t.events = {}; save(t); close();
    for (const k of Object.keys(evs)) { try { await gReq('DELETE', `calendars/${encodeURIComponent(evs[k].cal)}/events/${encodeURIComponent(evs[k].id)}`); } catch (x) {} }
    if (typeof ensureLoaded === 'function') try { ensureLoaded(true); } catch (x) {}
    toastMsg('🗑 Dossier supprimé');
  }

  // ---------- bandeau dans « Jour » : échéances d'aujourd'hui, demain et après-demain ----------
  function jourBox() {
    const box = document.getElementById('jour'); if (!box) return;
    const old = box.querySelector('.tx-jour'); if (old) old.remove();
    const ms = upcoming(2).filter(m => !m.info);
    if (!ms.length) return;
    const el = document.createElement('div'); el.className = 'tx-jour';
    el.innerHTML = `<div class="section-title">🚨 Dates limites de transactions</div>` + ms.map(m => `<div onclick="showTab({target:document.querySelector('.tab-btn[onclick*=transactions]')},'transactions');TX.open('${m.t.id}')">${msRow(m, true)}</div>`).join('');
    const title = box.querySelector('.section-title');
    if (title && title.nextSibling) box.insertBefore(el, title.nextSibling); else box.prepend(el);
  }
  // branche le rendu de « Jour » et remplace l'ancienne vue démo des transactions
  try {
    const orig = window.renderAll;
    if (typeof orig === 'function') window.renderAll = function () { const r = orig.apply(this, arguments); try { jourBox(); } catch (x) {} return r; };
    window.renderTransactionsView = render;
  } catch (x) {}

  window.TX = { render, open, close, edit, f, cf, cadd, cdel, saveForm, importFile, pdf, cstatus, done, resync, del, doDel, jourBox, _parse: parsePA, _milestones: milestones, _all: () => txs,
    _h: { readLines, frDate, gReq, busyOn, freeSlot, calId, countdown, fmtD, hh, money, addD, diffD, today, uuid, uploadPdf: async (id, file) => { try { const r = await fetch('/api/pdf?id=' + id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf' }, body: file }); return r.ok; } catch (x) { return false; } } } };
  render(); pull(); setTimeout(jourBox, 1500);
  // v16.1 : remettre à jour une fois les rappels déjà créés (heure du matin + nouvelles tâches)
  let migTries = 0;
  const mig = setInterval(async () => {
    if (++migTries > 40) return clearInterval(mig);
    if (typeof accessToken === 'undefined' || !accessToken) return;
    clearInterval(mig);
    list().forEach(t => { if (t.contactId && t.deedAt && window.CRM && CRM.setClosing) CRM.setClosing(t.contactId, t.deedAt); });
    const todo = list().filter(t => t.status !== 'fermee' && (t.evv || 0) < 3 && t.events && Object.keys(t.events).length);
    for (const t of todo) { t.evv = 3; try { await syncCalendar(t); } catch (x) {} }
    if (todo.length) toastMsg(`📅 Rappels de ${todo.length} dossier(s) replacés entre 9 h et 17 h, sans chevaucher tes rendez-vous`, 7000);
  }, 3000);
  window.addEventListener('online', flush);
})();

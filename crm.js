// ============================================================
// Motherboard — CRM (contacts) v1
// Données : d'abord sur l'appareil (instantané, hors-ligne), puis synchronisées
// avec Supabase via /api/contacts (téléphone ↔ ordinateur).
// ============================================================
(function () {
  const TYPES_C = {
    acheteur: { label: 'Acheteur', color: '#1976D2', stages: ['Nouveau lead', 'Qualifié (financement)', 'En recherche (Matrix)', 'En visites', "Offre d'achat", 'Conditions', 'Notaire', 'Client passé'] },
    vendeur:  { label: 'Vendeur',  color: '#9C27B0', stages: ['Lead', 'Évaluation', 'CCV signé', 'En vigueur', 'Offre acceptée', 'Conditions', 'Vendu / Notaire', 'Client passé'] },
    proprio:  { label: 'Proprio',  color: '#00796B', stages: ['À appeler', 'Appelé – rappeler', 'Intéressé', 'Rendez-vous', 'Signé', 'Pas intéressé', 'Injoignable'] },
    client:   { label: 'Client',   color: '#D4AF37', stages: ['Actif', 'Client passé'] }
  };
  // catégorie affichée : un proprio DuProprio devient « Vendeur potentiel » dès qu'on lui a parlé, puis « Vendeur » une fois signé
  const CATS = { vpot: { label: 'Vendeur potentiel', color: '#C2185B' } };
  function cat(c) {
    if (c.type !== 'proprio') return c.type;
    const st = c.stage || 'À appeler';
    if (st === 'Signé' || st === 'Converti en vendeur') return 'vendeur';
    if (st === 'Pas intéressé' || st === 'Injoignable') return 'proprio';
    if (c.isContact || c.suivi || st === 'Intéressé' || st === 'Rendez-vous') return 'vpot';
    return 'proprio';
  }
  function catInfo(c) { const k = cat(c); return CATS[k] || TYPES_C[k] || TYPES_C.client; }
  // nom affiché : « POT-Valérie - 418-100 rue Murray » pour les proprios dont on connaît le prénom
  function dname(c) {
    const o = String(c.owner || '').trim();
    if (c.type !== 'proprio' || !o) return c.name || '';
    return (cat(c) === 'vendeur' ? '' : 'POT-') + o + ' - ' + c.name;
  }
  const OUT = {
    pas_reponse:   { l: 'Pas de réponse', i: '📵', conv: false, days: 2 },
    message:       { l: 'Message laissé', i: '📨', conv: false, days: 3 },
    parle:         { l: 'Parlé',          i: '💬', conv: true },
    rdv:           { l: 'RDV fixé',       i: '📅', conv: true },
    pas_interesse: { l: 'Pas intéressé',  i: '🙅', conv: true, days: 90 }
  };
  const HOT = ['En visites', "Offre d'achat", 'Conditions', 'Notaire', 'Évaluation', 'CCV signé', 'En vigueur', 'Offre acceptée', 'Intéressé', 'Rendez-vous'];
  const CLOSED = ['Client passé', 'Pas intéressé', 'Vendu / Notaire', 'Converti en vendeur', 'Signé', 'Injoignable'];
  const SMART = [
    ['tous', 'Tous', () => true],
    ['appeler', '📞 À appeler', c => !c.dnc && isDue(c)],
    ['retard', '⏰ En retard', c => !c.dnc && c.nextFollowUp && c.nextFollowUp < todayStr()],
    ['nouveaux', '🆕 Nouveaux', c => !(c.calls || []).length && (!c.firstContact || daysSince(c.firstContact) <= 14)],
    ['sanscontact', '💤 30 j sans contact', c => !c.dnc && !CLOSED.includes(c.stage) && (!c.lastContact || daysSince(c.lastContact) > 30)],
    ['chauds', '🔥 Chauds', c => HOT.includes(c.stage)],
    ['dnc', '⛔ Ne pas appeler', c => !!c.dnc]
  ];
  let smart = 'tous';
  function daysSince(d) { return Math.round((new Date(todayStr() + 'T12:00:00') - new Date(String(d).slice(0, 10) + 'T12:00:00')) / 864e5); }
  function lastCall(c) { const a = c.calls || []; return a.length ? a[a.length - 1] : null; }
  function stats() {
    const today = todayStr(), wk = new Date(); wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7)); const wkStr = ymdC(wk);
    const s = { d: { calls: 0, conv: 0, rdv: 0 }, w: { calls: 0, conv: 0, rdv: 0 } };
    list().forEach(c => (c.calls || []).forEach(k => {
      const day = k.at.slice(0, 10); const o = OUT[k.outcome] || {};
      const add = (x) => { x.calls++; if (o.conv) x.conv++; if (k.outcome === 'rdv') x.rdv++; };
      if (ymdC(new Date(k.at)) === today) add(s.d);
      if (ymdC(new Date(k.at)) >= wkStr) add(s.w);
    }));
    return s;
  }
  const FILTERS = [['tous', 'Tous'], ['acheteur', 'Acheteurs'], ['vpot', 'Vendeurs potentiels'], ['vendeur', 'Vendeurs'], ['proprio', 'Proprios']];

  let contacts = {};                 // id -> contact
  let pending = new Set();           // ids à envoyer au serveur
  let syncState = 'local';           // ok | local | offline | auth
  let filter = 'tous', query = '';
  let openId = null, editing = null;

  // ---------- utilitaires ----------
  const $ = (s, r = document) => r.querySelector(s);
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s || ''));
  const todayStr = () => ymdC(new Date());
  function ymdC(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  // ---------- horaire d'appels : jours permis + bloc fixe (rappels automatiques seulement) ----------
  const CP_DEF = { days: [1, 2, 3, 4, 5], start: 600, end: 720 };
  function callPlan() { try { const p = JSON.parse(localStorage.getItem('mb_callplan') || 'null'); return Object.assign({}, CP_DEF, p || {}); } catch (x) { return Object.assign({}, CP_DEF); } }
  function setCallPlan(p) { try { localStorage.setItem('mb_callplan', JSON.stringify(Object.assign(callPlan(), p))); } catch (x) {} }
  function callDay(ymd) {
    const p = callPlan(); if (!p.days.length || p.days.length === 7) return ymd;
    const d = new Date(ymd + 'T12:00:00');
    for (let i = 0; i < 7 && !p.days.includes(d.getDay()); i++) d.setDate(d.getDate() + 1);
    return ymdC(d);
  }
  // créneau libre de 15 min dans le bloc d'appels pour ce jour-là (minutes depuis minuit)
  function callSlot(ymd) {
    const p = callPlan(); let n = 0;
    try { (typeof events !== 'undefined' ? events : []).forEach(ev => { if (ev.allDay || ymdC(ev.start) !== ymd) return; const m = ev.start.getHours() * 60 + ev.start.getMinutes(); if (m >= p.start && m < p.end && (ev.type === 'suivi' || /^📱 Rappeler/.test(ev.title || ''))) n++; }); } catch (x) {}
    const m = p.start + 15 * n; return m < p.end ? m : Math.max(p.start, p.end - 15);
  }
  // rappels automatiques (2 j, 3 j, 1 sem…) : jamais un jour non permis ; une date choisie à la main reste telle quelle
  function addDaysStr(n) { const d = new Date(); d.setDate(d.getDate() + n); return n > 0 ? callDay(ymdC(d)) : ymdC(d); }
  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  }
  function ago(s) {
    if (!s) return '';
    const days = Math.round((new Date(todayStr() + 'T12:00:00') - new Date(s.slice(0, 10) + 'T12:00:00')) / 864e5);
    if (days <= 0) return "aujourd'hui";
    if (days === 1) return 'hier';
    if (days < 30) return `il y a ${days} j`;
    if (days < 365) return `il y a ${Math.round(days / 30)} mois`;
    return `il y a ${Math.round(days / 365)} an(s)`;
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function initials(n) { return (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
  function safeUrl(u) { u = String(u || '').trim(); return /^(https?:|onenote:)/i.test(u) ? u : ''; }
  function linkBtns(c, cls) {
    const on = safeUrl(c.oneNote), dp = safeUrl(c.dpUrl);
    if (!on && !dp) return '';
    return `<div class="${cls}">${on ? `<a href="${e(on)}" target="_blank" rel="noopener">📓 Page OneNote</a>` : ''}${dp ? `<a href="${e(dp)}" target="_blank" rel="noopener">🏠 Fiche DuProprio</a>` : ''}</div>`;
  }
  function telHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }
  function list() { return Object.values(contacts).filter(c => !c.deleted); }
  function isDue(c, day) { return c.nextFollowUp && c.nextFollowUp <= (day || todayStr()); }

  // ---------- stockage + synchro ----------
  function persist() {
    try { localStorage.setItem('mb_contacts', JSON.stringify(contacts)); localStorage.setItem('mb_contacts_pending', JSON.stringify([...pending])); } catch (err) {}
  }
  function restore() {
    try {
      contacts = JSON.parse(localStorage.getItem('mb_contacts') || '{}') || {};
      pending = new Set(JSON.parse(localStorage.getItem('mb_contacts_pending') || '[]'));
    } catch (err) { contacts = {}; pending = new Set(); }
  }
  function save(c) {
    c.updatedAt = new Date().toISOString();
    contacts[c.id] = c;
    pending.add(c.id);
    persist();
    renderList();
    if (openId === c.id) renderSheet();
    refreshJour();
    if (window.Prospect && Prospect.changed) Prospect.changed();
    flush();
  }
  let flushing = false;
  async function flush() {
    if (flushing || !pending.size) return;
    flushing = true;
    try {
      const ids = [...pending];
      const items = ids.map(id => ({ id, data: contacts[id], updatedAt: contacts[id] && contacts[id].updatedAt })).filter(i => i.data);
      const r = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ items }) });
      if (r.ok) { ids.forEach(id => pending.delete(id)); persist(); setSync('ok'); }
      else setSync(r.status === 401 || r.status === 403 ? 'auth' : r.status === 503 ? 'local' : 'offline');
    } catch (err) { setSync('offline'); }
    flushing = false;
  }
  async function pull() {
    try {
      const r = await fetch('/api/contacts', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) { setSync(r.status === 401 || r.status === 403 ? 'auth' : r.status === 503 ? 'local' : 'offline'); return; }
      const { items } = await r.json();
      (items || []).forEach(it => {
        const mine = contacts[it.id];
        const theirs = Object.assign({}, it.data, { id: it.id });
        if (!mine || (!pending.has(it.id) && (theirs.updatedAt || '') >= (mine.updatedAt || ''))) contacts[it.id] = theirs;
        else if (pending.has(it.id) && (theirs.updatedAt || '') > (mine.updatedAt || '')) { contacts[it.id] = theirs; pending.delete(it.id); }
      });
      persist(); setSync('ok');
      try {
        // v15.9 : « Parlé » ne met plus en suivi tout seul — on garde en suivi seulement les fiches vraiment travaillées
        if (!localStorage.getItem('mb_suivi_mig')) {
          Object.values(contacts).forEach(c => { if (!c.deleted && c.type === 'proprio' && c.plist && c.suivi === undefined && c.stage === 'Appelé – rappeler') { c.suivi = !!(c.owner || c.offer || c.isContact); c.updatedAt = new Date().toISOString(); pending.add(c.id); } });
          localStorage.setItem('mb_suivi_mig', '1'); persist();
        }
        if (!localStorage.getItem('mb_cp_mig1')) {
          const t = todayStr();
          Object.values(contacts).forEach(c => { if (!c.deleted && c.type === 'proprio' && c.nextFollowUp && c.nextFollowUp > t) { const d = callDay(c.nextFollowUp); if (d !== c.nextFollowUp) { c.nextFollowUp = d; c.updatedAt = new Date().toISOString(); pending.add(c.id); } } });
          localStorage.setItem('mb_cp_mig1', 'contacts'); persist();
        }
      } catch (x) {}
      renderList(); if (openId) renderSheet(); refreshJour();
      flush();
    } catch (err) { setSync('offline'); }
  }
  function setSync(s) { syncState = s; const b = $('#crm-sync'); if (b) b.outerHTML = syncBanner(); }
  function syncBanner() {
    const n = pending.size;
    if (syncState === 'ok' && !n) return `<div id="crm-sync" class="crm-sync ok">✓ Synchronisé (téléphone ↔ ordinateur)</div>`;
    if (syncState === 'ok') return `<div id="crm-sync" class="crm-sync">Synchronisation… (${n})</div>`;
    if (syncState === 'auth') return `<div id="crm-sync" class="crm-sync warn">Connectez Google (en haut à droite) pour synchroniser vos contacts.</div>`;
    if (syncState === 'offline') return `<div id="crm-sync" class="crm-sync warn">Hors ligne : ${n} modification(s) en attente, envoi automatique au retour du réseau.</div>`;
    return `<div id="crm-sync" class="crm-sync warn">Enregistré sur cet appareil. La synchronisation téléphone ↔ ordinateur s'activera dès que la base de données sera branchée.</div>`;
  }

  // ---------- LISTE ----------
  function renderList() {
    const root = document.getElementById('contacts');
    if (!root) return;
    const q = query.trim().toLowerCase();
    const all = list();
    const sm = (SMART.find(x => x[0] === smart) || SMART[0])[2];
    // les fiches DuProprio pas encore appelées restent dans l'onglet Prospection (sinon la liste de contacts déborde)
    const rows = all.filter(c => !(filter === 'tous' && !q && c.plist && cat(c) === 'proprio') && sm(c) && (filter === 'tous' || cat(c) === filter) &&
      (!q || [c.name, c.owner, c.phone, c.email, c.address, c.neighborhoods, c.stage].join(' ').toLowerCase().includes(q)));
    const due = rows.filter(c => isDue(c)).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
    const rest = rows.filter(c => !isDue(c)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const counts = {}; all.forEach(c => { const k = cat(c); counts[k] = (counts[k] || 0) + 1; });

    const card = (c) => {
      const t = catInfo(c);
      const fu = c.nextFollowUp ? `<span class="crm-fu ${isDue(c) ? 'due' : ''}">🔔 ${c.nextFollowUp === todayStr() ? "Aujourd'hui" : fmtDate(c.nextFollowUp)}</span>` : '';
      return `<div class="crm-card" onclick="CRM.open('${c.id}')">
        <div class="crm-av" style="background:${t.color}">${e(initials(c.owner && c.type === 'proprio' ? c.owner : c.name))}</div>
        <div class="crm-main">
          <div class="crm-name">${e(dname(c))}</div>
          <div class="crm-sub"><span class="crm-badge" style="color:${t.color};border-color:${t.color}">${t.label}</span> ${e(c.stage || '')}</div>
          <div class="crm-sub2">${c.dnc ? '⛔ Ne pas appeler · ' : ''}${c.phone ? '📞 ' + e(c.phone) : ''}${lastCall(c) ? ` · ${OUT[lastCall(c).outcome].i} ${OUT[lastCall(c).outcome].l.toLowerCase()} ${ago(lastCall(c).at)}` : c.lastContact ? ` · dernier contact ${ago(c.lastContact)}` : ''}</div>
        </div>
        <div class="crm-right">${fu}${c.phone && !c.dnc ? `<a class="crm-call" href="${telHref(c.phone)}" onclick="event.stopPropagation()" aria-label="Appeler">📞</a>` : ''}</div>
      </div>`;
    };
    const st = stats();
    const callable = rows.filter(c => c.phone && !c.dnc);
    const smCount = (f) => all.filter(f).length;

    root.innerHTML = `
      <div class="crm-top">
        <input class="crm-search" type="search" placeholder="🔍 Rechercher…" value="${e(query)}" oninput="CRM.search(this.value)">
        <button class="crm-add crm-mic" onclick="VoiceCRM.open()" aria-label="Dicter une fiche">🎤</button><button class="crm-add" onclick="CRM.edit()">+ Contact</button>
      </div>
      <div class="crm-stats"><div><b>${st.d.calls}</b><span>appels<br>aujourd'hui</span></div><div><b>${st.d.conv}</b><span>conversa-<br>tions</span></div><div><b>${st.d.rdv}</b><span>RDV<br>fixés</span></div><div class="wk"><b>${st.w.calls} · ${st.w.conv} · ${st.w.rdv}</b><span>cette semaine<br>appels · conv. · RDV</span></div></div>
      <div class="crm-filters crm-smart">${SMART.map(([k, l, f]) => `<button class="${smart === k ? 'on' : ''}" onclick="CRM.smart('${k}')">${l} ${k === 'tous' ? '' : smCount(f)}</button>`).join('')}</div>
      ${callable.length && smart !== 'dnc' ? `<button class="crm-dial" onclick="CRM.dial()">▶ Appeler cette liste (${callable.length})</button>` : ''}
      <div class="crm-filters">${FILTERS.map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" onclick="CRM.filter('${k}')">${l}${k === 'tous' ? ` ${all.length}` : counts[k] ? ` ${counts[k]}` : ''}</button>`).join('')}</div>
      ${syncBanner()}
      ${!all.length ? `<div class="crm-empty"><b>Aucun contact pour l'instant.</b><br>Ajoutez votre premier client avec « + Contact ».<br><button class="cta-btn" onclick="CRM.edit()">+ Ajouter un contact</button></div>` : ''}
      ${due.length ? `<div class="crm-section">À relancer (${due.length})</div>${due.map(card).join('')}` : ''}
      ${rest.length ? `<div class="crm-section">${due.length ? 'Autres contacts' : 'Contacts'} (${rest.length})</div>${rest.map(card).join('')}` : ''}
      ${all.length && !rows.length ? `<div class="crm-empty">Aucun résultat.</div>` : ''}
      <div style="height:90px"></div>`;
    const s = root.querySelector('.crm-search');
    if (s && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('crm-search')) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  // ---------- FICHE ----------
  function modal() {
    let m = document.getElementById('crm-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'crm-modal'; m.className = 'modal';
      m.addEventListener('click', ev => { if (ev.target === m) CRM.close(); });
      m.innerHTML = '<div class="sheet crm-sheet" id="crm-sheet"></div>';
      document.body.appendChild(m);
    }
    return m;
  }
  function relatedEvents(c) {
    if (typeof events === 'undefined') return [];
    const n = (c.name || '').toLowerCase().trim();
    const first = n.split(/\s+/)[0];
    return events.filter(ev => ev.contactId === c.id || (n.length > 2 && (ev.title || '').toLowerCase().includes(n)) ||
      (first && first.length > 3 && n.split(/\s+/).length > 1 && (ev.title || '').toLowerCase().includes(n.split(/\s+/).slice(-1)[0]) && (ev.title || '').toLowerCase().includes(first)))
      .sort((a, b) => a.start - b.start);
  }
  function callPanel(c) {
    if (c.dnc) return `<div class="crm-dnc-banner">⛔ Ce contact ne doit pas être appelé.</div>`;
    return `<div class="f-label">Résultat de l'appel</div>
      <div class="crm-outcomes">${Object.entries(OUT).map(([k, o]) => `<button onclick="CRM.logCall('${k}')">${o.i}<span>${o.l}</span></button>`).join('')}</div>
      <div id="crm-after" class="crm-after"></div>`;
  }
  function timeline(c, evs) {
    const items = [];
    (c.notes || []).forEach(n => items.push({ at: n.at, html: `${e(n.text).replace(/\n/g, '<br>')}`, icon: '📝', del: `CRM.delNote('${n.id}')` }));
    (c.calls || []).forEach(k => items.push({ at: k.at, html: `<b>${OUT[k.outcome].l}</b>${k.dur ? ` · ⏱ ${Math.floor(k.dur / 60)} min ${String(k.dur % 60).padStart(2, '0')}` : ''}${k.note ? ' — ' + e(k.note) : ''}`, icon: OUT[k.outcome].i, del: `CRM.delCall('${k.id}')` }));
    (evs || []).forEach(x => items.push({ at: x.start.toISOString(), html: `${e(x.title)}${x.allDay ? '' : ' · ' + hhmm(x.start)}`, icon: x.start > new Date() ? '🗓' : '📅', future: x.start > new Date() }));
    if (!items.length) return '<div class="crm-muted">Rien pour l\'instant.</div>';
    return items.sort((a, b) => b.at.localeCompare(a.at)).map(it => `
      <div class="tl-item${it.future ? ' future' : ''}"><div class="tl-ic">${it.icon}</div><div class="tl-body"><div class="tl-date">${it.future ? 'À venir · ' : ''}${fmtDate(it.at)} · ${new Date(it.at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}${it.del ? `<button onclick="${it.del}" aria-label="Supprimer">✕</button>` : ''}</div>${it.html}</div></div>`).join('');
  }
  function renderSheet() {
    const c = contacts[openId];
    const sh = $('#crm-sheet');
    if (!c || !sh) return;
    const t = catInfo(c);
    const info = [
      ['Courriel', c.email ? `<a href="mailto:${e(c.email)}">${e(c.email)}</a>` : ''],
      ['Propriétaire', c.owner ? e(c.owner) : ''],
      ['Adresse', c.address ? e(c.address) : ''],
      ['Type', c.ptype ? e(c.ptype) : ''],
      ['Liste', c.plist ? e(c.plist) + (c.porder ? ' · #' + c.porder : '') : ''],
      ['Budget', c.budget ? e(c.budget) : ''],
      ['Recherche', c.propertyType ? e(c.propertyType) : ''],
      ['Quartiers', c.neighborhoods ? e(c.neighborhoods) : ''],
      [c.type === 'proprio' ? 'Prix demandé' : 'Prix espéré', c.price ? e(c.price) : ''],
      ['Commission', c.commission ? e(c.commission) + (String(c.commission).includes('%') ? '' : ' %') : ''],
      ['Source', c.source ? e(c.source) : ''],
      ['Premier contact', c.firstContact ? fmtDate(c.firstContact) : ''],
      ['Dernier contact', c.lastContact ? `${fmtDate(c.lastContact)} (${ago(c.lastContact)})` : '']
    ].filter(x => x[1]);
    const evs = relatedEvents(c);
    const now = new Date();
    const up = evs.filter(x => x.end >= now).slice(0, 5), past = evs.filter(x => x.end < now).slice(-3).reverse();
    const evRow = (x) => `<div class="crm-ev"><b>${fmtDate(ymdC(x.start))}${x.allDay ? '' : ' · ' + hhmm(x.start)}</b> ${e(x.title)}</div>`;
    const maps = c.address ? `https://maps.apple.com/?q=${encodeURIComponent(c.address)}` : '';
    const fuBtn = (n, l) => `<button onclick="CRM.followUp(${n === null ? 'null' : `'${addDaysStr(n)}'`})">${l}</button>`;

    sh.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="CRM.close()">✕</button><b>${e(dname(c))}</b><span class="sheet-acts"><button type="button" class="sheet-trash" onclick="CRM.askDelete(true)" title="Supprimer ce contact" aria-label="Supprimer ce contact">🗑</button><button class="sheet-save" onclick="CRM.edit('${c.id}')">Modifier</button></span></div>
      <div class="crm-hero"><div class="crm-av big" style="background:${t.color}">${e(initials(c.owner && c.type === 'proprio' ? c.owner : c.name))}</div>
        <div><span class="crm-badge" style="color:${t.color};border-color:${t.color}">${t.label}</span>${c.phone ? `<div class="crm-phone">${e(c.phone)}</div>` : ''}</div></div>
      <div class="crm-actions">
        <a class="${c.phone ? '' : 'off'}" href="${c.phone ? telHref(c.phone) : '#'}" onclick="CRM.touch()">📞<span>Appeler</span></a>
        <a class="${c.phone ? '' : 'off'}" href="${c.phone ? 'sms:' + String(c.phone).replace(/[^\d+]/g, '') : '#'}" onclick="CRM.touch()">💬<span>Texto</span></a>
        <a class="${c.email ? '' : 'off'}" href="${c.email ? 'mailto:' + e(c.email) : '#'}" onclick="CRM.touch()">✉️<span>Courriel</span></a>
        <a class="${maps ? '' : 'off'}" href="${maps || '#'}" target="_blank" rel="noopener">🗺<span>Itinéraire</span></a>
        <a href="#" onclick="event.preventDefault();CRM.meeting()">📅<span>Rendez-vous</span></a>
      </div>
      ${window.Prospect ? Prospect.thumbHtml(c, 'crm-thumb') : ''}
      ${linkBtns(c, 'crm-links')}
      <button class="crm-vcard" onclick="CRM.vcard()">📇 Ajouter à mes contacts iPhone</button>
      ${callPanel(c)}
      <div class="f-label">Étape du dossier</div>
      <div class="chips crm-stages">${(TYPES_C[c.type] || TYPES_C.client).stages.map(s => `<button class="${c.stage === s ? 'on' : ''}" onclick="CRM.stage(${JSON.stringify(s).replace(/"/g, '&quot;')})">${e(s)}</button>`).join('')}</div>
      <div class="f-label">Prochain suivi ${c.nextFollowUp ? `· <span class="${isDue(c) ? 'crm-due-txt' : ''}">${c.nextFollowUp === todayStr() ? "aujourd'hui" : fmtDate(c.nextFollowUp)}</span>` : '· aucun'}</div>
      <div class="chips">${fuBtn(0, "Aujourd'hui")}${fuBtn(1, '+1 j')}${fuBtn(3, '+3 j')}${fuBtn(7, '+1 sem')}${fuBtn(14, '+2 sem')}${fuBtn(30, '+1 mois')}${c.nextFollowUp ? fuBtn(null, '✓ Fait / aucun') : ''}
        <label class="crm-datepick">📅<input type="date" value="${c.nextFollowUp || ''}" onchange="CRM.followUp(this.value||null)"></label></div>
      ${info.length ? `<div class="crm-info">${info.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
      <div class="crm-flags">
        <label><input type="checkbox" ${c.dncChecked ? 'checked' : ''} onchange="CRM.flag('dncChecked', this.checked)"> LNNTE vérifiée</label>
        <label class="${c.dnc ? 'dnc-on' : ''}"><input type="checkbox" ${c.dnc ? 'checked' : ''} onchange="CRM.flag('dnc', this.checked)"> ⛔ Ne pas appeler</label>
      </div>
      <div class="f-label">Note</div>
      <div class="crm-note-add">
        <textarea id="crm-note" rows="3" placeholder="Résumé de l'appel, besoins, prochaines étapes… (🎤 touchez le micro du clavier pour dicter)"></textarea>
        <button class="sheet-save" onclick="CRM.addNote()">Ajouter la note</button>
      </div>
      <div class="f-label">Historique</div>
      <div class="crm-timeline">${timeline(c, evs)}</div>
      <div class="crm-del" id="crm-del"><button onclick="CRM.askDelete()">Supprimer ce contact</button></div>`;
  }

  // ---------- FORMULAIRE ----------
  function renderForm() {
    const c = editing;
    const t = TYPES_C[c.type] || TYPES_C.acheteur;
    const sh = $('#crm-sheet');
    const fld = (k, label, ph, type = 'text', extra = '') => `<label class="f-block">${label}<input type="${type}" name="${k}" value="${e(c[k] || '')}" placeholder="${ph || ''}" ${extra} autocomplete="off"></label>`;
    sh.innerHTML = `
      <form id="crm-form" onsubmit="CRM.saveForm(event)">
        <div class="sheet-head"><button type="button" class="sheet-x" onclick="CRM.cancelEdit()">✕</button><b>${contacts[c.id] ? 'Modifier le contact' : 'Nouveau contact'}</b><button type="submit" class="sheet-save">Enregistrer</button></div>
        <input name="name" class="f-title" placeholder="Nom complet" value="${e(c.name || '')}" autocomplete="off">
        <div class="f-label">Type</div>
        <div class="chips">${Object.entries(TYPES_C).filter(([k]) => k !== 'client' || c.type === 'client').map(([k, v]) => `<button type="button" class="${c.type === k ? 'on' : ''}" onclick="CRM.setType('${k}')">${v.label}</button>`).join('')}</div>
        <label class="f-block">Étape<select name="stage">${t.stages.map(s => `<option ${c.stage === s ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></label>
        ${fld('phone', 'Téléphone', '514 555-1234', 'tel', 'inputmode="tel"')}
        ${fld('email', 'Courriel', 'nom@exemple.com', 'email', 'inputmode="email"')}
        ${fld('address', c.type === 'acheteur' ? 'Adresse actuelle' : 'Adresse de la propriété', 'Optionnel')}
        ${c.type === 'acheteur' ? fld('budget', 'Budget', 'ex. 450 000 $ – 550 000 $') + fld('neighborhoods', 'Quartiers recherchés', 'ex. Plateau, Rosemont, Villeray') : ''}
        ${c.type === 'vendeur' ? fld('price', 'Prix espéré / minimum', 'ex. 625 000 $') : ''}
        ${c.type === 'proprio' ? fld('owner', 'Nom du propriétaire', 'ex. Mathieu') + fld('price', 'Prix demandé (DuProprio)', 'ex. 625 000 $') + fld('dpUrl', 'Lien DuProprio', 'https://duproprio.com/…', 'url', 'inputmode="url"') + fld('oneNote', 'Lien de la page OneNote', 'OneNote → clic droit sur la page → Copier le lien', 'url', 'inputmode="url"') : ''}
        ${fld('commission', 'Commission (%)', 'ex. 4', 'text', 'inputmode="decimal"')}
        ${fld('source', 'Source', 'ex. Centris, référence, appel proprio, Instagram')}
        <div class="f-row"><label>Premier contact<input type="date" name="firstContact" value="${e(c.firstContact || '')}"></label><label>Prochain suivi<input type="date" name="nextFollowUp" value="${e(c.nextFollowUp || '')}"></label></div>
        ${contacts[c.id] ? '' : `<label class="f-block">Première note<textarea name="firstNote" rows="3" placeholder="Ce qu'il cherche, sa situation… (🎤 dictée du clavier)"></textarea></label>`}
        <div class="f-msg" id="crm-msg"></div>
        <div style="height:12px"></div>
      </form>`;
  }
  function collectForm() {
    const f = $('#crm-form'); if (!f) return;
    ['name', 'stage', 'phone', 'email', 'address', 'budget', 'neighborhoods', 'price', 'owner', 'dpUrl', 'oneNote', 'commission', 'source', 'firstContact', 'nextFollowUp', 'firstNote'].forEach(k => {
      if (f[k]) editing[k] = f[k].value.trim();
    });
  }

  // ---------- Jour : suivis dus ----------
  function refreshJour() {
    const box = document.getElementById('jour');
    if (!box) return;
    const old = box.querySelector('.crm-due-box'); if (old) old.remove();
    const day = typeof selectedDate !== 'undefined' ? ymdC(selectedDate) : todayStr();
    const isToday = day === todayStr();
    const due = list().filter(c => c.nextFollowUp && (isToday ? c.nextFollowUp <= day : c.nextFollowUp === day))
      .sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
    if (!due.length) return;
    const el = document.createElement('div');
    el.className = 'crm-due-box';
    const nCall = due.filter(c => c.phone && !c.dnc).length;
    el.innerHTML = `<div class="section-title">🔔 Suivis à faire (${due.length})${nCall ? `<button class="due-dial" onclick="CRM.dial(CRM.dueIds())">▶ Appeler (${nCall})</button>` : ''}</div>` + due.map(c => {
      const t = TYPES_C[c.type] || TYPES_C.client;
      const late = c.nextFollowUp < todayStr();
      return `<div class="crm-card" onclick="CRM.open('${c.id}')"><div class="crm-av" style="background:${t.color}">${e(initials(c.name))}</div>
        <div class="crm-main"><div class="crm-name">${e(c.name)}</div><div class="crm-sub">${t.label} · ${e(c.stage || '')}${late ? ` · <span class="crm-due-txt">en retard (${fmtDate(c.nextFollowUp)})</span>` : ''}</div></div>
        <div class="crm-right" style="flex-direction:row;align-items:center">${c.phone ? `<a class="crm-call" href="${telHref(c.phone)}" onclick="event.stopPropagation()">📞</a>` : ''}<button class="crm-done" title="Suivi fait" onclick="event.stopPropagation();CRM.doneFollowUp('${c.id}')">✓</button></div></div>`;
    }).join('');
    const title = box.querySelector('.section-title');
    if (title && title.nextSibling) box.insertBefore(el, title.nextSibling); else box.appendChild(el);
  }

  // ---------- API publique (onclick) ----------
  window.CRM = {
    upsert(c) { save(c); return c; },
    focus(id) { openId = id; },
    _timeline(id) { const c = contacts[id]; return c ? timeline(c, relatedEvents(c)) : ''; },
    newId: () => uuid(),
    types: TYPES_C,
    filter(k) { filter = k; renderList(); },
    smart(k) { smart = k; renderList(); },
    flag(k, v) { const c = contacts[openId]; if (!c) return; c[k] = v; if (k === 'dnc' && v) c.nextFollowUp = ''; save(c); },
    logCall(outcome, opts = {}) {
      const id = opts.id || openId; const c = contacts[id]; if (!c) return;
      const ta = document.getElementById(opts.noteId || 'crm-note');
      const note = ta && ta.value.trim() ? ta.value.trim() : '';
      c.calls = c.calls || [];
      const dur = window.Prospect && Prospect.takeCallDur ? Prospect.takeCallDur() : 0;
      c.calls.push(Object.assign({ id: uuid(), at: new Date().toISOString(), outcome, note, prevFu: c.nextFollowUp || '', prevStage: c.stage || '' }, dur ? { dur } : {}));
      c.lastContact = todayStr();
      const o = OUT[outcome];
      if (o.days) c.nextFollowUp = addDaysStr(o.days);
      if (outcome === 'rdv') c.nextFollowUp = '';
      if (outcome === 'pas_interesse' && c.type === 'proprio') c.stage = 'Pas intéressé';
      if (outcome === 'rdv' && c.type === 'proprio') c.stage = 'Rendez-vous';
      if (outcome === 'parle' && c.type === 'proprio' && (!c.stage || c.stage === 'À appeler')) c.stage = 'Appelé – rappeler';
      // 6 essais sans jamais parler à la personne → « Injoignable » (on arrête de l'appeler)
      if (!o.conv && c.type === 'proprio') {
        let n = 0; for (let k = c.calls.length - 1; k >= 0 && !OUT[c.calls[k].outcome].conv; k--) n++;
        if (n >= 6) { c.stage = 'Injoignable'; c.nextFollowUp = ''; }
      }
      if (ta) ta.value = '';
      save(c);
      if (opts.silent) return o;
      const after = document.getElementById('crm-after');
      if (outcome === 'parle') {
        if (after) after.innerHTML = `<div class="crm-after-q">Quand le rappeler ?</div><div class="chips">${[[3, '3 jours (il réfléchit)'], [7, '1 sem'], [14, '2 sem (pas maintenant)'], [30, '1 mois'], [90, '3 mois']].map(([d, l]) => `<button onclick="CRM.planFollow(${d})">${l}</button>`).join('')}<button onclick="CRM.planFollow(0, true)">Aucun</button></div><label class="crm-cal"><input type="checkbox" id="crm-cal" checked> Ajouter « 📱 Rappeler » à mon agenda</label>`;
      } else if (outcome === 'rdv') { CRM.meeting(); }
      else if (typeof toast === 'function') toast(`${o.i} ${o.l} — prochain suivi ${o.days ? 'dans ' + (o.days >= 30 ? Math.round(o.days / 30) + ' mois' : o.days + ' jours') : ''} <button onclick="CRM.undoCall('${id}')">Annuler</button>`);
      return o;
    },
    async planFollow(days, none) {
      const c = contacts[openId]; if (!c) return;
      const after = document.getElementById('crm-after');
      const wantCal = !none && document.getElementById('crm-cal') && document.getElementById('crm-cal').checked;
      c.nextFollowUp = none ? '' : addDaysStr(days); save(c);
      if (wantCal && window.VoiceCRM && VoiceCRM.reminder) {
        const r = await VoiceCRM.reminder(c, { date: new Date(c.nextFollowUp + 'T12:00:00'), start: callSlot(c.nextFollowUp) }).catch(() => 'error');
        if (typeof toast === 'function') toast(r === 'ok' ? '📅 Rappel ajouté à votre agenda' : "Suivi enregistré (l'agenda n'a pas pu être mis à jour)");
      }
      if (after) after.innerHTML = '';
    },
    undoCall(id) {
      const c = contacts[id]; if (!c || !(c.calls || []).length) return;
      const k = c.calls.pop(); if (k && 'prevFu' in k) { c.nextFollowUp = k.prevFu; c.stage = k.prevStage || c.stage; } save(c); document.querySelectorAll('.mb-toast').forEach(x => x.remove());
    },
    delCall(callId) { const c = contacts[openId]; c.calls = (c.calls || []).filter(k => k.id !== callId); save(c); },
    dial(ids) { Dialer.start(ids || (() => { const sm = (SMART.find(x => x[0] === smart) || SMART[0])[2]; return list().filter(c => sm(c) && (filter === 'tous' || cat(c) === filter) && c.phone && !c.dnc).sort((a, b) => (a.nextFollowUp || '9').localeCompare(b.nextFollowUp || '9')).map(c => c.id); })()); },
    dueIds() { return list().filter(c => !c.dnc && isDue(c) && c.phone).map(c => c.id); },
    _out: OUT,
    _stats: () => stats(),
    callPlan, setCallPlan, callDay, callSlot,
    // une seule fois : les rappels de prospection déjà prévus un jour non permis passent au prochain jour d'appels
    _migrateCal(evs, move) {
      try { if (localStorage.getItem('mb_cp_mig_cal')) return; } catch (x) { return; }
      const p = callPlan(), now = new Date(); let moved = 0;
      (evs || []).forEach(ev => {
        const c = ev.contactId && contacts[ev.contactId];
        if (!c || c.type !== 'proprio' || ev.allDay || ev.start < now || p.days.includes(ev.start.getDay()) || !/^📱 Rappeler/.test(ev.title || '')) return;
        const day = callDay(ymdC(ev.start)), m = callSlot(day);
        const ns = new Date(day + 'T00:00:00'); ns.setHours(Math.floor(m / 60), m % 60, 0, 0);
        move(ev, ns, new Date(ns.getTime() + (ev.end - ev.start)), { silent: true, keepView: true }); moved++;
      });
      try { localStorage.setItem('mb_cp_mig_cal', '1'); } catch (x) {}
      if (moved && typeof toast === 'function') toast(`📅 ${moved} rappel${moved > 1 ? 's' : ''} du week-end déplacé${moved > 1 ? 's' : ''} au prochain jour d'appels (${String(Math.floor(p.start / 60))} h)`);
    },
    // fiche contact → carte vCard : l'iPhone (ou le Mac) propose « Créer un contact »
    vcard(id) {
      const c = contacts[id || openId]; if (!c) return;
      const esc2 = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
      const pot = c.type === 'proprio' && (c.plist || c.listingNo);
      const fn = pot ? `POT-${String(c.owner || '').trim() || 'Proprio'} - ${c.name}` : c.name;
      const parts = String(c.name || '').trim().split(/\s+/);
      let last = parts.length > 1 ? parts.pop() : '', first = parts.join(' ');
      if (pot) { first = fn; last = ''; }   // tout dans le prénom, comme Julien les entre à la main
      const t = TYPES_C[c.type] || TYPES_C.client;
      const note = [t.label + (c.stage ? ' · ' + c.stage : ''), c.budget ? 'Budget : ' + c.budget : '', c.price ? 'Prix : ' + c.price : '', c.neighborhoods ? 'Quartiers : ' + c.neighborhoods : '', c.dpUrl ? 'DuProprio : ' + c.dpUrl : '', c.offer ? 'Proposé : ' + Number(c.offer.amount).toLocaleString('fr-CA') + ' $ (' + String(c.offer.pct).replace('.', ',') + ' %)' : '', 'Fiche Motherboard'].filter(Boolean).join(' — ');
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc2(last)};${esc2(first)};;;`, `FN:${esc2(fn)}`,
        c.phone ? `TEL;TYPE=CELL:${String(c.phone).replace(/[^\d+]/g, '')}` : '', c.email ? `EMAIL;TYPE=INTERNET:${esc2(c.email)}` : '',
        c.address ? `ADR;TYPE=HOME:;;${esc2(c.address)};;;;` : '', `NOTE:${esc2(note)}`, 'END:VCARD'].filter(Boolean);
      const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/vcard;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = (fn || 'contact').replace(/[\\/:*?"<>|]+/g, '').trim() + '.vcf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (!/iPhone|iPad|Android/i.test(navigator.userAgent)) { if (typeof toast === 'function') toast(`📇 « ${fn}.vcf » téléchargé — ouvre-le (barre de téléchargement) puis « Importer » dans Contacts : iCloud l'envoie sur ton iPhone.`); return; }
      if (typeof toast === 'function') toast('📇 Touchez « Créer un nouveau contact » (ou « Ajouter ») pour l\'enregistrer dans votre téléphone.');
    },
    search(v) { query = v; renderList(); },
    open(id) { openId = id; editing = null; modal().classList.add('open'); renderSheet(); },
    close() { openId = null; editing = null; const m = document.getElementById('crm-modal'); if (m) m.classList.remove('open'); },
    edit(id) {
      const base = id ? contacts[id] : { id: uuid(), type: filter !== 'tous' ? filter : 'acheteur', firstContact: todayStr(), notes: [], createdAt: new Date().toISOString() };
      editing = JSON.parse(JSON.stringify(base));
      if (!editing.stage) editing.stage = (TYPES_C[editing.type] || TYPES_C.acheteur).stages[0];
      openId = id || null;
      modal().classList.add('open'); renderForm();
      setTimeout(() => { const n = $('#crm-form [name=name]'); if (n && !id) n.focus(); }, 50);
    },
    setType(k) { collectForm(); editing.type = k; if (!TYPES_C[k].stages.includes(editing.stage)) editing.stage = TYPES_C[k].stages[0]; renderForm(); },
    cancelEdit() { if (openId && contacts[openId]) { editing = null; renderSheet(); } else CRM.close(); },
    saveForm(ev) {
      ev.preventDefault(); collectForm();
      if (!editing.name) { $('#crm-msg').textContent = 'Le nom est obligatoire.'; return; }
      const c = editing; const note = c.firstNote; delete c.firstNote;
      if (note) { c.notes = c.notes || []; c.notes.push({ id: uuid(), at: new Date().toISOString(), text: note }); c.lastContact = todayStr(); }
      editing = null; openId = c.id; save(c); renderSheet();
    },
    stage(s) { const c = contacts[openId]; if (!c) return; c.stage = s; save(c); },
    followUp(d) { const c = contacts[openId]; if (!c) return; c.nextFollowUp = d || ''; save(c); },
    touch() { const c = contacts[openId]; if (!c) return; c.lastContact = todayStr(); save(c); },
    addNote() {
      const ta = $('#crm-note'); const txt = ta && ta.value.trim(); if (!txt) return;
      const c = contacts[openId]; c.notes = c.notes || [];
      c.notes.push({ id: uuid(), at: new Date().toISOString(), text: txt }); c.lastContact = todayStr(); save(c);
    },
    delNote(nid) { const c = contacts[openId]; c.notes = (c.notes || []).filter(n => n.id !== nid); save(c); },
    askDelete(scroll) { const d = $('#crm-del'); if (!d) return; if (scroll) d.scrollIntoView({ behavior: 'smooth', block: 'center' }); d.innerHTML = `Supprimer ce contact ? <button class="danger" onclick="CRM.doDelete()">Oui, supprimer</button><button onclick="CRM.open('${openId}')">Annuler</button>`; },
    doDelete() {
      const c = contacts[openId]; if (!c) return; c.deleted = true; save(c); CRM.close(); renderList();
      if (window.Prospect && Prospect.changed) Prospect.changed();
      window.__undoDel = () => { c.deleted = false; save(c); renderList(); if (window.Prospect && Prospect.changed) Prospect.changed(); document.querySelectorAll('.mb-toast').forEach(x => x.remove()); };
      if (typeof toast === 'function') toast(`🗑 « ${e(c.name)} » supprimé <button onclick="__undoDel()">Annuler</button>`, 8000);
    },
    meeting() {
      const c = contacts[openId]; if (!c) return;
      CRM.close();
      if (typeof openAddForm !== 'function') return;
      openAddForm();
      const f = document.getElementById('add-form'); if (!f) return;
      const verb = c.type === 'acheteur' ? 'Visite' : c.type === 'proprio' ? 'Appel' : 'Rendez-vous';
      f.querySelector('[name=title]').value = `${verb} – ${c.name}`;
      if (c.address && c.type !== 'acheteur') f.querySelector('[name=location]').value = c.address;
      if (typeof setFormType === 'function') setFormType(c.type === 'acheteur' ? 'visite' : c.type === 'proprio' ? 'suivi' : 'reunion');
      window.pendingContactId = c.id;
    },
    logMeeting(id, title, when) {
      const c = contacts[id]; if (!c) return;
      c.notes = c.notes || []; c.notes.push({ id: uuid(), at: new Date().toISOString(), text: `📅 Rendez-vous planifié : ${title} (${when})` });
      c.lastContact = todayStr(); save(c);
    },
    doneFollowUp(id, opts = {}) {
      const c = contacts[id]; if (!c) return;
      const prev = c.nextFollowUp;
      c.nextFollowUp = '';
      c.lastContact = todayStr();
      c.notes = c.notes || [];
      c.notes.push({ id: uuid(), at: new Date().toISOString(), text: '✅ Suivi fait' + (opts.title ? ` (${opts.title.replace(/^✅\s*/, '')})` : '') });
      save(c);
      if (!opts.fromEvent && typeof doneEventsForContact === 'function') doneEventsForContact(id);
      if (!opts.fromEvent && typeof toast === 'function') {
        window.__undoFU = () => { c.nextFollowUp = prev; c.notes = c.notes.filter(n => !/^✅ Suivi fait/.test(n.text) || n.at < new Date(Date.now() - 60000).toISOString()); save(c); document.querySelectorAll('.mb-toast').forEach(x => x.remove()); };
        toast(`✓ Suivi fait : ${e(c.name)} <button onclick="__undoFU()">Annuler</button>`);
      }
    },
    find(name) { return window.Voice && Voice.findContact ? Voice.findContact(name) : null; },
    dueToday() { return list().filter(c => isDue(c)).length; },
    _all: () => contacts
  };

  // ---------- MODE APPELS (comme le dialer de Follow Up Boss) ----------
  const Dialer = {
    q: [], i: 0, done: {},
    start(ids) {
      if (!ids.length) { if (typeof toast === 'function') toast('Aucun contact à appeler dans cette liste.'); return; }
      this.q = ids; this.i = 0; this.done = {};
      let m = document.getElementById('dial-modal');
      if (!m) { m = document.createElement('div'); m.id = 'dial-modal'; m.className = 'modal'; m.innerHTML = '<div class="sheet dial-sheet" id="dial-sheet"></div>'; document.body.appendChild(m); }
      m.classList.add('open'); this.render();
    },
    render() {
      const sh = document.getElementById('dial-sheet');
      if (this.i >= this.q.length) return this.summary();
      const c = contacts[this.q[this.i]]; if (!c) { this.i++; return this.render(); }
      const t = TYPES_C[c.type] || TYPES_C.client;
      const lc = lastCall(c);
      const lastNote = (c.notes || []).slice(-1)[0];
      sh.innerHTML = `
        <div class="sheet-head"><button type="button" class="sheet-x" onclick="Dialer.stop()">✕</button><b>Mode appels · ${this.i + 1} / ${this.q.length}</b><button class="sheet-save" onclick="Dialer.next()">Passer ›</button></div>
        <div class="dial-progress"><i style="width:${Math.round(this.i / this.q.length * 100)}%"></i></div>
        <div class="dial-card">
          ${window.Prospect && Prospect.thumb(c.id) ? Prospect.thumbHtml(c, 'dial-thumb') : `<div class="crm-av big" style="background:${t.color}">${e(initials(c.name))}</div>`}
          <div class="dial-name">${e(c.name)}${c.owner ? ' · ' + e(c.owner) : ''}</div>
          ${c.ptype || c.porder ? `<div class="dial-meta">${c.ptype ? e(c.ptype) : ''}${c.porder ? ' · fiche #' + c.porder : ''}</div>` : ''}
          <div class="crm-sub"><span class="crm-badge" style="color:${t.color};border-color:${t.color}">${t.label}</span> ${e(c.stage || '')}</div>
          ${c.address ? `<div class="dial-meta">📍 ${e(c.address)}</div>` : ''}
          ${c.budget || c.price ? `<div class="dial-meta">💰 ${e(c.budget || c.price)}</div>` : ''}
          ${lc ? `<div class="dial-meta">Dernier appel : ${OUT[lc.outcome].i} ${OUT[lc.outcome].l} ${ago(lc.at)} · ${(c.calls || []).length} tentative(s)</div>` : '<div class="dial-meta">Jamais appelé</div>'}
          ${linkBtns(c, 'crm-links dial-links')}
          ${lastNote ? `<div class="dial-note">📝 ${e(lastNote.text).slice(0, 220)}</div>` : ''}
          ${!c.dncChecked ? `<div class="dial-warn">LNNTE non vérifiée · <a href="https://lnnte-dncl.gc.ca/" target="_blank" rel="noopener">vérifier</a> · <button onclick="Dialer.lnnte()">✓ Vérifiée</button></div>` : ''}
        </div>
        <a class="dial-call" href="${telHref(c.phone)}">📞 Appeler ${e(c.phone)}</a>
        <textarea id="dial-note" rows="2" placeholder="Note de l'appel (🎤 dictée du clavier)"></textarea>
        <div class="crm-outcomes">${Object.entries(OUT).map(([k, o]) => `<button onclick="Dialer.log('${k}')">${o.i}<span>${o.l}</span></button>`).join('')}</div>
        <div id="dial-after" class="crm-after"></div>
        <button class="dial-open" onclick="Dialer.open()">Ouvrir la fiche complète</button>`;
    },
    lnnte() { const c = contacts[this.q[this.i]]; c.dncChecked = true; save(c); this.render(); },
    log(outcome) {
      const id = this.q[this.i];
      const o = CRM.logCall(outcome, { id, noteId: 'dial-note', silent: true });
      this.done[outcome] = (this.done[outcome] || 0) + 1;
      this.last = { id, outcome, i: this.i };
      if (outcome !== 'parle' && outcome !== 'rdv' && typeof toast === 'function') toast(`${OUT[outcome].i} ${OUT[outcome].l} — ${e(contacts[id].name)} <button onclick="Dialer.undo()">Annuler</button>`);
      if (outcome === 'parle') {
        document.getElementById('dial-after').innerHTML = `<div class="crm-after-q">Quand le rappeler ?</div><div class="chips">${[[3, '3 jours (il réfléchit)'], [7, '1 sem'], [14, '2 sem (pas maintenant)'], [30, '1 mois'], [90, '3 mois']].map(([d, l]) => `<button onclick="Dialer.follow(${d})">${l}</button>`).join('')}<button onclick="Dialer.follow(0, true)">Aucun</button></div>${contacts[id].type === 'proprio' && contacts[id].plist ? `<label class="crm-cal"><input type="checkbox" id="dial-suivi"> 📌 Mettre en suivi (sinon reste dans « À appeler »)</label>` : ''}<label class="crm-cal"><input type="checkbox" id="dial-cal" checked> Ajouter « 📱 Rappeler » à mon agenda</label>`;
        return;
      }
      if (outcome === 'rdv') { const c = contacts[id]; Dialer.pauseFor(c); return; }
      this.next();
    },
    async follow(days, none) {
      const c = contacts[this.q[this.i]];
      const wantCal = !none && document.getElementById('dial-cal') && document.getElementById('dial-cal').checked;
      const su = document.getElementById('dial-suivi'); if (su && su.checked) c.suivi = true;
      c.nextFollowUp = none ? '' : addDaysStr(days); save(c);
      if (wantCal && window.VoiceCRM && VoiceCRM.reminder) VoiceCRM.reminder(c, { date: new Date(c.nextFollowUp + 'T12:00:00'), start: callSlot(c.nextFollowUp) }).catch(() => {});
      this.next();
    },
    pauseFor(c) {
      // RDV : on ouvre le formulaire de rendez-vous, puis on revient à la liste
      document.getElementById('dial-modal').classList.remove('open');
      openId = c.id; CRM.meeting();
      const back = () => { const m = document.getElementById('add-modal'); if (m && m.classList.contains('open')) return setTimeout(back, 500); Dialer.i++; document.getElementById('dial-modal').classList.add('open'); Dialer.render(); };
      setTimeout(back, 800);
    },
    next() { this.i++; this.render(); },
    undo() {
      const l = this.last; if (!l) return;
      CRM.undoCall(l.id); this.done[l.outcome] = Math.max(0, (this.done[l.outcome] || 1) - 1);
      this.last = null; this.i = l.i; document.getElementById('dial-modal').classList.add('open'); this.render();
    },
    open() { const id = this.q[this.i]; document.getElementById('dial-modal').classList.remove('open'); CRM.open(id); },
    stop() { document.getElementById('dial-modal').classList.remove('open'); renderList(); },
    summary() {
      const d = this.done, tot = Object.values(d).reduce((a, b) => a + b, 0);
      const conv = Object.entries(d).filter(([k]) => OUT[k].conv).reduce((a, [, v]) => a + v, 0);
      document.getElementById('dial-sheet').innerHTML = `
        <div class="sheet-head"><button type="button" class="sheet-x" onclick="Dialer.stop()">✕</button><b>Session terminée 🎉</b><span style="width:60px"></span></div>
        <div class="crm-stats big"><div><b>${tot}</b><span>appels</span></div><div><b>${conv}</b><span>conversations</span></div><div><b>${d.rdv || 0}</b><span>RDV</span></div></div>
        <div class="crm-info">${Object.entries(OUT).map(([k, o]) => `<div><span>${o.i} ${o.l}</span><b>${d[k] || 0}</b></div>`).join('')}</div>
        <button class="sheet-save voice-go" onclick="Dialer.stop()">Terminer</button>`;
    }
  };
  window.Dialer = Dialer;

  // ---------- branchements avec l'app ----------
  restore();
  window.renderContactsView = renderList;
  const origRenderJour = window.renderJour;
  if (typeof origRenderJour === 'function') window.renderJour = function () { origRenderJour.apply(this, arguments); refreshJour(); };
  window.addEventListener('load', () => { renderList(); refreshJour(); setTimeout(pull, 800); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  window.addEventListener('online', flush);
  setInterval(() => { if (pending.size) flush(); }, 30000);
})();

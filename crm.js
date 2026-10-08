// ============================================================
// Motherboard — CRM (contacts) v1
// Données : d'abord sur l'appareil (instantané, hors-ligne), puis synchronisées
// avec Supabase via /api/contacts (téléphone ↔ ordinateur).
// ============================================================
(function () {
  const TYPES_C = {
    acheteur: { label: 'Acheteur', color: '#1976D2', stages: ['Nouveau lead', 'Qualifié (financement)', 'En recherche (Matrix)', 'En visites', "Offre d'achat", 'Conditions', 'Notaire', 'Client passé'] },
    vendeur:  { label: 'Vendeur',  color: '#9C27B0', stages: ['Lead', 'Évaluation', 'CCV signé', 'En vigueur', 'Offre acceptée', 'Conditions', 'Vendu / Notaire', 'Client passé'] },
    proprio:  { label: 'Proprio',  color: '#00796B', stages: ['À appeler', 'Appelé – rappeler', 'Intéressé', 'Rendez-vous', 'Converti en vendeur', 'Pas intéressé'] },
    client:   { label: 'Client',   color: '#D4AF37', stages: ['Actif', 'Client passé'] }
  };
  const FILTERS = [['tous', 'Tous'], ['acheteur', 'Acheteurs'], ['vendeur', 'Vendeurs'], ['proprio', 'Proprios'], ['client', 'Clients']];

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
  function addDaysStr(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymdC(d); }
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
    const rows = all.filter(c => (filter === 'tous' || c.type === filter) &&
      (!q || [c.name, c.phone, c.email, c.address, c.neighborhoods, c.stage].join(' ').toLowerCase().includes(q)));
    const due = rows.filter(c => isDue(c)).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
    const rest = rows.filter(c => !isDue(c)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const counts = {}; all.forEach(c => counts[c.type] = (counts[c.type] || 0) + 1);

    const card = (c) => {
      const t = TYPES_C[c.type] || TYPES_C.client;
      const fu = c.nextFollowUp ? `<span class="crm-fu ${isDue(c) ? 'due' : ''}">🔔 ${c.nextFollowUp === todayStr() ? "Aujourd'hui" : fmtDate(c.nextFollowUp)}</span>` : '';
      return `<div class="crm-card" onclick="CRM.open('${c.id}')">
        <div class="crm-av" style="background:${t.color}">${e(initials(c.name))}</div>
        <div class="crm-main">
          <div class="crm-name">${e(c.name)}</div>
          <div class="crm-sub"><span class="crm-badge" style="color:${t.color};border-color:${t.color}">${t.label}</span> ${e(c.stage || '')}</div>
          <div class="crm-sub2">${c.phone ? '📞 ' + e(c.phone) : ''}${c.lastContact ? ` · dernier contact ${ago(c.lastContact)}` : ''}</div>
        </div>
        <div class="crm-right">${fu}${c.phone ? `<a class="crm-call" href="${telHref(c.phone)}" onclick="event.stopPropagation()" aria-label="Appeler">📞</a>` : ''}</div>
      </div>`;
    };

    root.innerHTML = `
      <div class="crm-top">
        <input class="crm-search" type="search" placeholder="🔍 Rechercher…" value="${e(query)}" oninput="CRM.search(this.value)">
        <button class="crm-add crm-mic" onclick="VoiceCRM.open()" aria-label="Dicter une fiche">🎤</button><button class="crm-add" onclick="CRM.edit()">+ Contact</button>
      </div>
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
  function renderSheet() {
    const c = contacts[openId];
    const sh = $('#crm-sheet');
    if (!c || !sh) return;
    const t = TYPES_C[c.type] || TYPES_C.client;
    const info = [
      ['Courriel', c.email ? `<a href="mailto:${e(c.email)}">${e(c.email)}</a>` : ''],
      ['Adresse', c.address ? e(c.address) : ''],
      ['Budget', c.budget ? e(c.budget) : ''],
      ['Recherche', c.propertyType ? e(c.propertyType) : ''],
      ['Quartiers', c.neighborhoods ? e(c.neighborhoods) : ''],
      ['Prix espéré', c.price ? e(c.price) : ''],
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
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="CRM.close()">✕</button><b>${e(c.name)}</b><button class="sheet-save" onclick="CRM.edit('${c.id}')">Modifier</button></div>
      <div class="crm-hero"><div class="crm-av big" style="background:${t.color}">${e(initials(c.name))}</div>
        <div><span class="crm-badge" style="color:${t.color};border-color:${t.color}">${t.label}</span>${c.phone ? `<div class="crm-phone">${e(c.phone)}</div>` : ''}</div></div>
      <div class="crm-actions">
        <a class="${c.phone ? '' : 'off'}" href="${c.phone ? telHref(c.phone) : '#'}" onclick="CRM.touch()">📞<span>Appeler</span></a>
        <a class="${c.phone ? '' : 'off'}" href="${c.phone ? 'sms:' + String(c.phone).replace(/[^\d+]/g, '') : '#'}" onclick="CRM.touch()">💬<span>Texto</span></a>
        <a class="${c.email ? '' : 'off'}" href="${c.email ? 'mailto:' + e(c.email) : '#'}" onclick="CRM.touch()">✉️<span>Courriel</span></a>
        <a class="${maps ? '' : 'off'}" href="${maps || '#'}" target="_blank" rel="noopener">🗺<span>Itinéraire</span></a>
        <a href="#" onclick="event.preventDefault();CRM.meeting()">📅<span>Rendez-vous</span></a>
      </div>
      <div class="f-label">Étape du dossier</div>
      <div class="chips crm-stages">${t.stages.map(s => `<button class="${c.stage === s ? 'on' : ''}" onclick="CRM.stage(${JSON.stringify(s).replace(/"/g, '&quot;')})">${e(s)}</button>`).join('')}</div>
      <div class="f-label">Prochain suivi ${c.nextFollowUp ? `· <span class="${isDue(c) ? 'crm-due-txt' : ''}">${c.nextFollowUp === todayStr() ? "aujourd'hui" : fmtDate(c.nextFollowUp)}</span>` : '· aucun'}</div>
      <div class="chips">${fuBtn(0, "Aujourd'hui")}${fuBtn(1, '+1 j')}${fuBtn(3, '+3 j')}${fuBtn(7, '+1 sem')}${fuBtn(14, '+2 sem')}${fuBtn(30, '+1 mois')}${c.nextFollowUp ? fuBtn(null, '✓ Fait / aucun') : ''}
        <label class="crm-datepick">📅<input type="date" value="${c.nextFollowUp || ''}" onchange="CRM.followUp(this.value||null)"></label></div>
      ${info.length ? `<div class="crm-info">${info.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
      <div class="f-label">Notes</div>
      <div class="crm-note-add">
        <textarea id="crm-note" rows="3" placeholder="Résumé de l'appel, besoins, prochaines étapes… (🎤 touchez le micro du clavier pour dicter)"></textarea>
        <button class="sheet-save" onclick="CRM.addNote()">Ajouter la note</button>
      </div>
      <div class="crm-notes">${(c.notes || []).slice().sort((a, b) => b.at.localeCompare(a.at)).map(n => `
        <div class="crm-note"><div class="crm-note-date">${fmtDate(n.at)} · ${new Date(n.at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}<button onclick="CRM.delNote('${n.id}')" aria-label="Supprimer la note">✕</button></div>${e(n.text).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="crm-muted">Aucune note pour l\'instant.</div>'}</div>
      <div class="f-label">Rendez-vous</div>
      ${up.length || past.length ? `${up.length ? `<div class="crm-muted">À venir</div>${up.map(evRow).join('')}` : ''}${past.length ? `<div class="crm-muted" style="margin-top:6px">Passés</div>${past.map(evRow).join('')}` : ''}` : '<div class="crm-muted">Aucun rendez-vous trouvé dans votre agenda pour ce nom.</div>'}
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
        <div class="chips">${Object.entries(TYPES_C).map(([k, v]) => `<button type="button" class="${c.type === k ? 'on' : ''}" onclick="CRM.setType('${k}')">${v.label}</button>`).join('')}</div>
        <label class="f-block">Étape<select name="stage">${t.stages.map(s => `<option ${c.stage === s ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></label>
        ${fld('phone', 'Téléphone', '514 555-1234', 'tel', 'inputmode="tel"')}
        ${fld('email', 'Courriel', 'nom@exemple.com', 'email', 'inputmode="email"')}
        ${fld('address', c.type === 'acheteur' ? 'Adresse actuelle' : 'Adresse de la propriété', 'Optionnel')}
        ${c.type === 'acheteur' ? fld('budget', 'Budget', 'ex. 450 000 $ – 550 000 $') + fld('neighborhoods', 'Quartiers recherchés', 'ex. Plateau, Rosemont, Villeray') : ''}
        ${c.type === 'vendeur' || c.type === 'proprio' ? fld('price', 'Prix espéré / minimum', 'ex. 625 000 $') : ''}
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
    ['name', 'stage', 'phone', 'email', 'address', 'budget', 'neighborhoods', 'price', 'commission', 'source', 'firstContact', 'nextFollowUp', 'firstNote'].forEach(k => {
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
    el.innerHTML = `<div class="section-title">🔔 Suivis à faire (${due.length})</div>` + due.map(c => {
      const t = TYPES_C[c.type] || TYPES_C.client;
      const late = c.nextFollowUp < todayStr();
      return `<div class="crm-card" onclick="CRM.open('${c.id}')"><div class="crm-av" style="background:${t.color}">${e(initials(c.name))}</div>
        <div class="crm-main"><div class="crm-name">${e(c.name)}</div><div class="crm-sub">${t.label} · ${e(c.stage || '')}${late ? ` · <span class="crm-due-txt">en retard (${fmtDate(c.nextFollowUp)})</span>` : ''}</div></div>
        <div class="crm-right">${c.phone ? `<a class="crm-call" href="${telHref(c.phone)}" onclick="event.stopPropagation()">📞</a>` : ''}</div></div>`;
    }).join('');
    const title = box.querySelector('.section-title');
    if (title && title.nextSibling) box.insertBefore(el, title.nextSibling); else box.appendChild(el);
  }

  // ---------- API publique (onclick) ----------
  window.CRM = {
    upsert(c) { save(c); return c; },
    newId: () => uuid(),
    types: TYPES_C,
    filter(k) { filter = k; renderList(); },
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
    askDelete() { $('#crm-del').innerHTML = `Supprimer définitivement ce contact ? <button class="danger" onclick="CRM.doDelete()">Oui, supprimer</button><button onclick="CRM.open('${openId}')">Annuler</button>`; },
    doDelete() { const c = contacts[openId]; if (!c) return; c.deleted = true; save(c); CRM.close(); },
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
    dueToday() { return list().filter(c => isDue(c)).length; },
    _all: () => contacts
  };

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

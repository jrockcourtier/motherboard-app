// ============================================================
// Motherboard — Fiche contact par la voix
// « Discussion avec Danny Bouchard, acheteur, il cherche une maison dans Rosemont,
//   budget 550 000, on se rappelle mardi prochain pour rediscuter. »
// → remplit la fiche, pose les questions manquantes, ajoute la note,
//   et crée « 📱 Rappeler Danny Bouchard » dans Google Agenda.
// ============================================================
(function () {
  const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s || ''));
  const pad = (n) => String(n).padStart(2, '0');
  const ymdL = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const NOT_NAMES = new Set(['Il', 'Elle', 'On', 'Je', 'Nous', 'Ils', 'Elles', 'Le', 'La', 'Les', 'Un', 'Une', 'Discussion', 'Appel', 'Rencontre', 'Rendez-vous', 'Note', 'Nouveau', 'Nouvelle', 'Client', 'Cliente', 'Acheteur', 'Acheteuse', 'Vendeur', 'Vendeuse', 'Monsieur', 'Madame', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Budget', 'Demain', 'Ok', 'Oui', 'Non']);

  // ---------- extraction ----------
  function money(t) {
    // « 550 000 », « 550k », « 550 mille », « 1,2 million », « 500 000 $ »
    let m = t.match(/(\d+(?:[.,]\d+)?)\s*(millions?|m\$)/i);
    if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 1e6);
    m = t.match(/(\d{2,3})\s*(?:k|mille)\b/i);
    if (m) return +m[1] * 1000;
    m = t.match(/(\d{1,3}(?:[\s .,]\d{3})+|\d{5,7})/);
    if (m) return +m[1].replace(/[\s .,]/g, '');
    return null;
  }
  const fmtMoney = (n) => n ? n.toLocaleString('fr-CA') + ' $' : '';

  function extractName(original) {
    const rx = /(?:avec|à|a|parl[ée]\s+(?:à|a|avec)|client(?:e)?|contact|monsieur|madame|m\.|mme|appel(?:é|e)?|rencontr[ée]e?|nomm[ée]e?|s'appelle)\s+((?:[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+)(?:\s+(?:[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+|de|du|des|van|le|la)){0,3})/gu;
    let m;
    while ((m = rx.exec(original))) {
      let words = m[1].split(/\s+/);
      while (words.length && /^(de|du|des|van|le|la)$/i.test(words[words.length - 1])) words.pop();
      words = words.filter((w, i) => !(i === 0 && NOT_NAMES.has(w)));
      if (words.length && !words.every(w => NOT_NAMES.has(w))) return words.join(' ');
    }
    // début de phrase : « Danny Bouchard, acheteur… »
    m = original.match(/^\s*((?:[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+)\s+[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+)\s*[,:-]/u);
    if (m && !m[1].split(/\s+/).some(w => NOT_NAMES.has(w))) return m[1];
    return '';
  }

  function relDate(t, now) {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    const NUM = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, dix: 10, quinze: 15 };
    let m = t.match(/dans\s+(\d+|un|une|deux|trois|quatre|cinq|six|dix|quinze)\s+(jours?|semaines?|mois)/);
    if (m) {
      const n = /^\d+$/.test(m[1]) ? +m[1] : NUM[m[1]];
      const d = new Date(d0);
      if (/jour/.test(m[2])) d.setDate(d.getDate() + n);
      else if (/semaine/.test(m[2])) d.setDate(d.getDate() + 7 * n);
      else d.setMonth(d.getMonth() + n);
      return d;
    }
    if (/la semaine prochaine/.test(t)) { const d = new Date(d0); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d; } // lundi prochain
    if (/le mois prochain/.test(t)) return new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    if (/en fin de semaine|ce week-end|cette fin de semaine/.test(t)) { const d = new Date(d0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return d; }
    return null;
  }

  function parseFollowUp(original, now = new Date()) {
    const t = strip(original);
    const km = t.match(/(rappeler|se rappelle|se rappeler|rappelle[rz]?|rappel|relancer|relance|recontacter|reparler|rediscuter|suivi|se reparle|on se revoit|le revoir|la revoir|lui reparler|recommuniquer)/);
    if (!km) return null;
    const after = original.slice(km.index);
    const before = original.slice(Math.max(0, km.index - 60), km.index);
    let date = relDate(strip(after), now) || relDate(strip(before), now), start = null;
    const p1 = window.Voice ? Voice.parse(after, now) : null;
    if (!date && p1 && p1.date) { date = p1.date; start = p1.start; }
    else if (p1 && p1.start != null && /\d|midi/.test(strip(after))) start = p1.start;
    if (!date && window.Voice) { const p2 = Voice.parse(before, now); if (p2.date) { date = p2.date; if (p2.start != null) start = p2.start; } }
    return { wanted: true, date, start };
  }

  function parseContact(raw, now = new Date()) {
    const original = String(raw || '').trim();
    let txt = original.replace(/\s+arobase\s+/gi, '@').replace(/@\s+/g, '@');
    const t = strip(txt);
    const out = { raw: original, name: '', existing: null, type: null, phone: '', email: '', budget: '', price: '', neighborhoods: '', propertyType: '', source: '', followUp: null };

    out.existing = window.Voice && Voice.findContact ? Voice.findContact(original) : null;
    out.name = out.existing ? out.existing.name : extractName(original);

    if (/\b(acheteu[rs]e?|acheteurs|achete|acheter|cherche (?:une|un|a acheter)|premier achat|preapprouv)/.test(t)) out.type = 'acheteur';
    if (/\b(vendeu[rs]e?|vendre|vend sa|mettre en vente|inscription|evaluation de sa)/.test(t)) out.type = out.type && /vendre .* acheter|acheter .* vendre/.test(t) ? out.type : 'vendeur';
    if (/\b(proprio|proprietaire)\b/.test(t) && !out.type) out.type = 'proprio';

    let m = txt.match(/(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
    if (m) out.phone = `${m[1]} ${m[2]}-${m[3]}`;
    m = txt.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    if (m) out.email = m[0].toLowerCase();

    m = t.match(/(?:budget|jusqu'a|maximum|max|autour de|environ|entre|preapprouve(?:e)? (?:a|pour)|prix|demande|veut avoir|espere|vise|vendre (?:pour|a))[^.;]{0,40}/);
    if (m) {
      const seg = m[0];
      const range = seg.match(/entre\s+([\d\s.,]+(?:k|mille|millions?)?)\s*(?:\$|dollars)?\s+et\s+([\d\s.,]+(?:k|mille|millions?)?)/);
      let val = '';
      if (range) { const a = money(range[1]), b = money(range[2]); if (a && b) val = `${fmtMoney(a)} – ${fmtMoney(b)}`; }
      if (!val) { const n = money(seg.replace(/^\D+/, '')); if (n && n >= 50000) val = fmtMoney(n); }
      if (val) { if (/prix|demande|veut avoir|espere|vise|vendre/.test(seg) || out.type === 'vendeur' || out.type === 'proprio') out.price = val; else out.budget = val; }
    }

    m = t.match(/(?<!\d\s)\b(maison|condo|condominium|plex|duplex|triplex|quadruplex|bungalow|cottage|jumele|maison de ville|terrain|semi-detache|chalet|appartement)s?\b(?:[^.,;]{0,30}?\b(\d)\s*(?:chambres?|cc)\b)?/);
    if (m) out.propertyType = m[1].replace('jumele', 'jumelé').replace('semi-detache', 'semi-détaché') + (m[2] ? ` · ${m[2]} chambres` : '');
    const ch = !out.propertyType.includes('chambres') && t.match(/\b(\d)\s*(?:chambres?|cc)\b/);
    if (ch) out.propertyType = (out.propertyType ? out.propertyType + ' · ' : '') + ch[1] + ' chambres';

    const nm = txt.match(/(?:secteur|quartier|coin|région|region|intéressée? par|interessee? par|dans|sur le|sur la|à|a)\s+(?:de |du |d'|le |la |les |l')?(?:secteur |quartier |coin |région |region )?(?:de |du |d'|des )?((?:[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+)(?:[\s-](?:[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+|de|du|des|sur|la|le))*(?:\s*(?:,|et|ou)\s*(?:[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+)(?:[\s-](?:[A-ZÉÈÀÂÎÔÛÇ][\p{L}'’-]+|de|du|sur|la|le))*)*)/u);
    if (nm) {
      let n = nm[1].replace(/\s+(de|du|des|sur|la|le)$/i, '');
      const nameWords = new Set(out.name.split(/\s+/));
      if (!n.split(/[\s,-]+/).some(w => nameWords.has(w) || NOT_NAMES.has(w))) out.neighborhoods = n.replace(/\s+(et|ou)\s+/g, ', ');
    }

    m = t.match(/(?:refere|reference|recommande) par\s+([a-z' -]{3,30})|(?:vient de|via|trouve sur|source)\s+(centris|instagram|facebook|realtor|google|duproprio|une visite libre|visite libre|mon site)/);
    if (m) out.source = (m[1] ? 'Référence : ' + m[1].trim().replace(/\b\w/g, ch => ch.toUpperCase()) : m[2].replace(/^./, ch => ch.toUpperCase()));

    out.followUp = parseFollowUp(original, now);
    if (!out.type && out.existing) out.type = out.existing.type;
    return out;
  }

  // ---------- questions ----------
  function questions(p) {
    const q = [];
    if (!p.name) q.push({ key: 'name', ask: 'Quel est le nom du client ?', ph: 'Prénom et nom' });
    if (!p.type) q.push({ key: 'type', ask: 'Est-ce un acheteur, un vendeur ou un proprio ?', chips: [['acheteur', 'Acheteur'], ['vendeur', 'Vendeur'], ['proprio', 'Proprio'], ['client', 'Client']] });
    const ex = p.existing || {};
    if (!p.phone && !ex.phone) q.push({ key: 'phone', ask: 'Quel est son numéro de téléphone ?', ph: '514 555-1234', inputmode: 'tel' });
    if ((p.type === 'acheteur') && !p.budget && !ex.budget) q.push({ key: 'budget', ask: 'Quel est son budget ?', ph: 'ex. 450 000 $' });
    if ((p.type === 'acheteur') && !p.neighborhoods && !ex.neighborhoods) q.push({ key: 'neighborhoods', ask: 'Quels secteurs l\'intéressent ?', ph: 'ex. Rosemont, Villeray' });
    if ((p.type === 'vendeur' || p.type === 'proprio') && !p.price && !ex.price) q.push({ key: 'price', ask: 'Quel prix espère-t-il ?', ph: 'ex. 625 000 $' });
    if (!p.followUp || !p.followUp.date) q.push({ key: 'followUp', ask: p.followUp ? 'Quand voulez-vous le rappeler ?' : 'Voulez-vous un rappel ? Quand ?', ph: 'ex. mardi prochain à 10 h, dans 2 semaines…', chips: [['+1', 'Demain'], ['+7', 'Dans 1 semaine'], ['+14', 'Dans 2 semaines'], ['+30', 'Dans 1 mois']] });
    return q;
  }

  // ---------- état + interface ----------
  let state = null; // { p, qs, i }
  let rec = null;

  function modal() {
    let m = document.getElementById('vc-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'vc-modal'; m.className = 'modal';
    m.addEventListener('click', ev => { if (ev.target === m) VoiceCRM.close(); });
    m.innerHTML = '<div class="sheet voice-sheet vc-sheet" id="vc-sheet"></div>';
    document.body.appendChild(m);
    return m;
  }
  const sheetEl = () => document.getElementById('vc-sheet');
  const head = (title) => `<div class="sheet-head"><button type="button" class="sheet-x" onclick="VoiceCRM.close()">✕</button><b>${title}</b><span style="width:60px"></span></div>`;

  function micHint(id) {
    return IOS || !SRC
      ? `<div class="voice-hint">👇 Touchez le <b>🎤 du clavier</b> et parlez, puis <b>OK</b>.</div>`
      : `<button type="button" class="voice-mic small" id="${id}" onclick="VoiceCRM.listen('${id}')">🎤</button><div class="voice-hint">Touchez le micro et parlez, ou tapez.</div>`;
  }

  function listen(btnId, taId) {
    if (IOS || !SRC) { const ta = document.getElementById(taId); if (ta) ta.focus(); return; }
    const btn = document.getElementById(btnId), ta = document.getElementById(taId);
    if (rec) { try { rec.stop(); } catch (er) {} rec = null; btn && btn.classList.remove('on'); return; }
    rec = new SRC(); rec.lang = 'fr-CA'; rec.interimResults = true; rec.continuous = true;
    const base = ta.value ? ta.value + ' ' : '';
    rec.onresult = (ev) => { let s = ''; for (let i = 0; i < ev.results.length; i++) s += ev.results[i][0].transcript; ta.value = base + s; ta.dispatchEvent(new Event('input')); };
    rec.onend = () => { rec = null; btn && btn.classList.remove('on'); };
    rec.onerror = () => { rec = null; btn && btn.classList.remove('on'); ta.focus(); };
    try { rec.start(); btn && btn.classList.add('on'); } catch (er) { ta.focus(); }
  }

  function renderDictate(prefill) {
    sheetEl().innerHTML = head('Fiche contact à la voix') + micHint('vc-mic0') + `
      <textarea id="vc-text" rows="6" placeholder="Ex. : Discussion avec Danny Bouchard, acheteur. Il cherche une maison dans Rosemont, budget 550 000. On se rappelle mardi prochain pour rediscuter."></textarea>
      <div id="vc-live" class="voice-preview"></div>
      <button type="button" class="sheet-save voice-go" onclick="VoiceCRM.analyze()">Continuer</button>
      <div class="voice-ex">Dites tout ce que vous savez : nom, acheteur/vendeur, téléphone, budget, secteur, type de propriété, et quand le rappeler. L'app vous demandera ce qui manque.</div>`;
    const ta = document.getElementById('vc-text');
    ta.value = prefill || '';
    let last = '';
    const upd = () => { if (ta.value === last) return; last = ta.value; livePreview(ta.value); };
    ['input', 'change', 'keyup', 'paste'].forEach(ev => ta.addEventListener(ev, () => setTimeout(upd, 0)));
    clearInterval(state && state.poll); state = { poll: setInterval(upd, 500) };
    if (IOS || !SRC) ta.focus(); else listen('vc-mic0', 'vc-text');
    upd();
  }

  function rows(p) {
    const r = [];
    if (p.name) r.push(['Nom', (p.existing ? '👤 ' : '') + e(p.name) + (p.existing ? ' <small>(fiche existante)</small>' : '')]);
    if (p.type) r.push(['Type', CRM.types[p.type] ? CRM.types[p.type].label : p.type]);
    if (p.phone) r.push(['Téléphone', e(p.phone)]);
    if (p.email) r.push(['Courriel', e(p.email)]);
    if (p.budget) r.push(['Budget', e(p.budget)]);
    if (p.price) r.push(['Prix espéré', e(p.price)]);
    if (p.propertyType) r.push(['Recherche', e(p.propertyType)]);
    if (p.neighborhoods) r.push(['Secteurs', e(p.neighborhoods)]);
    if (p.source) r.push(['Source', e(p.source)]);
    if (p.followUp && p.followUp.date) r.push(['Rappel', '📅 ' + p.followUp.date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }) + (p.followUp.start != null ? ` · ${pad(Math.floor(p.followUp.start / 60))}:${pad(p.followUp.start % 60)}` : '')]);
    return r.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }
  function livePreview(txt) {
    const box = document.getElementById('vc-live'); if (!box) return;
    box.innerHTML = txt.trim() ? rows(parseContact(txt)) : '';
  }

  function renderQuestion() {
    const { p, qs, i } = state;
    if (i >= qs.length) return renderSummary();
    const q = qs[i];
    sheetEl().innerHTML = head(`Question ${i + 1} / ${qs.length}`) + `
      <div class="vc-q">${q.ask}</div>
      ${q.chips ? `<div class="chips vc-chips">${q.chips.map(([v, l]) => `<button type="button" onclick="VoiceCRM.answer(${JSON.stringify(v).replace(/"/g, '&quot;')})">${l}</button>`).join('')}</div>` : ''}
      ${q.key !== 'type' ? micHint('vc-micq') + `<input id="vc-ans" class="vc-ans" placeholder="${q.ph || ''}" ${q.inputmode ? `inputmode="${q.inputmode}"` : ''} enterkeyhint="next" autocomplete="off">` : ''}
      <div class="vc-nav"><button type="button" class="vc-skip" onclick="VoiceCRM.answer(null)">Passer</button>${q.key !== 'type' ? '<button type="button" class="sheet-save" onclick="VoiceCRM.answer(document.getElementById(\'vc-ans\').value)">Suivant</button>' : ''}</div>
      <div class="voice-preview vc-mini">${rows(p)}</div>`;
    const inp = document.getElementById('vc-ans');
    if (inp) {
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); VoiceCRM.answer(inp.value); } });
      if (IOS || !SRC) inp.focus(); else listen('vc-micq', 'vc-ans');
    }
  }

  function applyAnswer(q, v) {
    const p = state.p;
    if (v == null || !String(v).trim()) { if (q.key === 'followUp') p.followUp = null; return; }
    v = String(v).trim();
    if (q.key === 'name') { p.name = v.replace(/^./, c => c.toUpperCase()); const ex = window.Voice && Voice.findContact(v); if (ex) { p.existing = ex; p.name = ex.name; } }
    else if (q.key === 'type') p.type = v;
    else if (q.key === 'phone') { const m = v.match(/(\d{3})\D*(\d{3})\D*(\d{4})/); p.phone = m ? `${m[1]} ${m[2]}-${m[3]}` : v; }
    else if (q.key === 'budget' || q.key === 'price') {
      const t = strip(v); const r = t.match(/([\d\s.,]+(?:k|mille|millions?)?)\s*(?:\$|dollars)?\s+(?:et|a)\s+([\d\s.,]+(?:k|mille|millions?)?)/);
      let val = ''; if (r) { const a = money(r[1]), b = money(r[2]); if (a && b) val = `${fmtMoney(a < 5000 ? a * 1000 : a)} – ${fmtMoney(b < 5000 ? b * 1000 : b)}`; }
      if (!val) { const n = money(t); val = n ? fmtMoney(n < 5000 ? n * 1000 : n) : v; }
      p[q.key] = val;
    }
    else if (q.key === 'neighborhoods') p.neighborhoods = v.replace(/\s+(et|ou)\s+/gi, ', ');
    else if (q.key === 'followUp') {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      if (/^\+\d+$/.test(v)) { const d = new Date(now); d.setDate(d.getDate() + +v.slice(1)); p.followUp = { wanted: true, date: d, start: null }; }
      else {
        const t = strip(v);
        if (/^(non|pas de rappel|aucun|non merci)\b/.test(t)) { p.followUp = null; return; }
        let d = relDate(t, new Date()), start = null;
        const pp = window.Voice ? Voice.parse(v) : null;
        if (!d && pp && pp.date) d = pp.date;
        if (pp && pp.start != null) start = pp.start;
        if (d) p.followUp = { wanted: true, date: d, start };
      }
    }
  }

  function renderSummary() {
    clearInterval(state.poll);
    const p = state.p;
    const hasRem = p.followUp && p.followUp.date;
    const canCal = typeof accessToken !== 'undefined' && !!accessToken || (typeof serverAuth !== 'undefined' && serverAuth);
    sheetEl().innerHTML = head(p.existing ? 'Mettre la fiche à jour' : 'Nouvelle fiche contact') + `
      <div class="voice-preview">${rows(p)}</div>
      <div class="f-label" style="text-align:left">Note ajoutée à la fiche</div>
      <textarea id="vc-note" rows="4">${e(p.raw)}</textarea>
      ${hasRem ? `<label class="vc-rem"><input type="checkbox" id="vc-cal" ${canCal ? 'checked' : ''}> Créer « 📱 Rappeler ${e(p.name)} » dans mon agenda Google</label>` : '<div class="voice-hint" style="margin-top:10px">Aucun rappel prévu.</div>'}
      <div id="vc-msg" class="f-msg"></div>
      <div class="vc-nav"><button type="button" class="vc-skip" onclick="VoiceCRM.edit()">Corriger</button><button type="button" class="sheet-save" id="vc-save" onclick="VoiceCRM.save()">${p.existing ? 'Mettre à jour' : 'Créer la fiche'}</button></div>`;
  }

  async function createReminder(c, fu) {
    if (typeof accessToken === 'undefined') return 'no-app';
    if (!accessToken && typeof getServerToken === 'function') await getServerToken();
    if (!accessToken) return 'no-token';
    const start = new Date(fu.date);
    if (fu.start != null) start.setHours(Math.floor(fu.start / 60), fu.start % 60, 0, 0); else start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 15 * 60000);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const cals = (typeof writableCals !== 'undefined' && writableCals.length) ? writableCals : [{ id: 'primary' }];
    let calId = 'primary';
    try { const last = JSON.parse(localStorage.getItem('mb_lastcal')); if (last && cals.some(x => x.id === last)) calId = last; else calId = (cals.find(x => x.primary) || cals[0]).id; } catch (er) {}
    const body = {
      summary: `📱 Rappeler ${c.name}`,
      description: [c.phone ? 'Tél. : ' + c.phone : '', c.stage ? 'Étape : ' + c.stage : '', 'Dernière note : ' + ((c.notes || []).slice(-1)[0] || {}).text].filter(Boolean).join('\n'),
      colorId: '6',
      start: { dateTime: start.toISOString(), timeZone: tz }, end: { dateTime: end.toISOString(), timeZone: tz },
      extendedProperties: { private: { mbType: 'suivi', mbContact: c.id } },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }
    };
    const send = () => fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let r = await send();
    if (r.status === 401 && typeof getServerToken === 'function' && await getServerToken()) r = await send();
    if (r.status === 403) return 'no-permission';
    if (!r.ok) return 'error';
    const created = await r.json();
    if (typeof events !== 'undefined' && typeof normalize === 'function') { events.push(normalize(created, { id: calId, summary: (cals.find(x => x.id === calId) || {}).name || '' })); if (typeof renderAll === 'function') renderAll(); }
    return 'ok';
  }

  window.VoiceCRM = {
    parse: parseContact,
    open(prefill) {
      if (window.Voice && Voice.close) Voice.close();
      modal().classList.add('open');
      renderDictate(prefill);
    },
    close() {
      if (rec) try { rec.stop(); } catch (er) {}
      if (state) clearInterval(state.poll);
      const m = document.getElementById('vc-modal'); if (m) m.classList.remove('open');
    },
    listen(btnId) { listen(btnId, btnId === 'vc-mic0' ? 'vc-text' : 'vc-ans'); },
    analyze() {
      const txt = document.getElementById('vc-text').value;
      if (!txt.trim()) { document.getElementById('vc-text').focus(); return; }
      if (rec) try { rec.stop(); } catch (er) {}
      clearInterval(state && state.poll);
      const p = parseContact(txt);
      state = { p, qs: questions(p), i: 0 };
      renderQuestion();
    },
    answer(v) {
      if (rec) try { rec.stop(); } catch (er) {}
      const q = state.qs[state.i];
      applyAnswer(q, v);
      // une réponse peut faire apparaître de nouvelles questions (ex. type → budget)
      const done = state.qs.slice(0, state.i + 1).map(x => x.key);
      state.qs = done.map(k => state.qs.find(x => x.key === k)).concat(questions(state.p).filter(x => !done.includes(x.key)));
      state.i++;
      if (!state.p.name && state.i >= state.qs.length) { state.qs.push({ key: 'name', ask: 'Il me faut au moins le nom du client :', ph: 'Prénom et nom' }); }
      renderQuestion();
    },
    edit() { renderDictate(document.getElementById('vc-note') ? document.getElementById('vc-note').value : state.p.raw); },
    async save() {
      const p = state.p;
      const btn = document.getElementById('vc-save'); btn.disabled = true; btn.textContent = 'Enregistrement…';
      const now = new Date().toISOString(), today = ymdL(new Date());
      const base = p.existing ? JSON.parse(JSON.stringify(CRM._all()[p.existing.id] || p.existing)) : { id: CRM.newId(), firstContact: today, notes: [], createdAt: now, source: '' };
      const c = base;
      c.name = c.name || p.name;
      if (p.type) c.type = p.type; c.type = c.type || 'acheteur';
      const stages = CRM.types[c.type].stages;
      if (!c.stage || !stages.includes(c.stage)) c.stage = stages[0];
      ['phone', 'email', 'budget', 'price', 'neighborhoods', 'propertyType', 'source'].forEach(k => { if (p[k]) c[k] = p[k]; });
      const note = (document.getElementById('vc-note') || {}).value || p.raw;
      c.notes = c.notes || [];
      if (note.trim()) c.notes.push({ id: CRM.newId(), at: now, text: '🎤 ' + note.trim() });
      c.lastContact = today;
      if (p.followUp && p.followUp.date) c.nextFollowUp = ymdL(p.followUp.date);
      CRM.upsert(c);
      let msg = '';
      const wantCal = document.getElementById('vc-cal') && document.getElementById('vc-cal').checked;
      if (wantCal) {
        const r = await createReminder(c, p.followUp).catch(() => 'error');
        if (r === 'ok') { c.notes.push({ id: CRM.newId(), at: new Date().toISOString(), text: `📅 Rappel ajouté à l'agenda : ${p.followUp.date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}` }); CRM.upsert(c); }
        else msg = r === 'no-permission' ? "Fiche enregistrée. Le rappel n'a pas pu être ajouté à l'agenda : touchez « + » puis « Autoriser l'ajout de rendez-vous »." : "Fiche enregistrée. Le rappel n'a pas pu être ajouté à l'agenda (connexion Google). Il apparaîtra quand même dans « Suivis à faire ».";
      }
      VoiceCRM.close();
      CRM.open(c.id);
      if (msg) setTimeout(() => alertBar(msg), 300);
    }
  };

  function alertBar(msg) {
    const d = document.createElement('div'); d.className = 'vc-toast'; d.textContent = msg;
    document.body.appendChild(d); setTimeout(() => d.remove(), 7000);
  }
})();

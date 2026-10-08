// ============================================================
// Motherboard — Commande vocale
// « Ajoute-moi un rendez-vous demain de midi à midi et demi avec Marc Tremblay, titre rencontre client »
// → ouvre le formulaire de rendez-vous déjà rempli (vous confirmez avec « Enregistrer »).
// Tout est analysé sur l'appareil : rien n'est envoyé ailleurs que Google Agenda.
// ============================================================
(function () {
  const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
  const MOIS_N = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const JOURS_N = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const NOMBRES = { une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, 'dix-sept': 17, 'dix-huit': 18, 'dix-neuf': 19, vingt: 20, trente: 30, quarante: 40, 'quarante-cinq': 45, cinquante: 50 };

  // ---------- heures ----------
  // renvoie des minutes depuis minuit, ou null
  function parseTime(t) {
    t = t.trim();
    let m, h = null, min = 0;
    if (/^midi/.test(t)) { h = 12; t = t.slice(4); }
    else if (/^minuit/.test(t)) { h = 0; t = t.slice(6); }
    else if ((m = t.match(/^(\d{1,2})\s*(?:h|:|heures?)\s*(\d{2})?/))) { h = +m[1]; min = m[2] ? +m[2] : 0; t = t.slice(m[0].length); }
    else if ((m = t.match(/^(une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)\s+heures?/))) { h = NOMBRES[m[1]]; t = t.slice(m[0].length); }
    else return null;
    t = t.trim();
    if (/^et (demie?|30)/.test(t)) min = 30;
    else if (/^et quart/.test(t)) min = 15;
    else if (/^moins (le )?quart/.test(t)) { h -= 1; min = 45; }
    else if ((m = t.match(/^(\d{2})\b/)) && !min) min = +m[1];
    if (/du soir|de l'apres-midi|pm/.test(t.slice(0, 20)) && h < 12) h += 12;
    else if (!/du matin|am/.test(t.slice(0, 15)) && h >= 1 && h <= 6) h += 12; // « à 2 h » = 14 h
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  const TIME_RX = '(midi(?: et (?:demie?|quart))?|minuit|\\d{1,2}\\s*(?:h|:|heures?)(?:\\s*\\d{2})?(?: et (?:demie?|quart)| moins (?:le )?quart)?(?: du (?:matin|soir)| de l\'apres-midi)?|(?:une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze) heures?(?: et (?:demie?|quart)| moins (?:le )?quart)?(?: du (?:matin|soir)| de l\'apres-midi)?)';

  function parseDuration(t) {
    let m = t.match(/(?:pendant|pour|duree(?: de)?|dure)\s+(\d+|une|deux|trois|quinze|trente|quarante-cinq|vingt)\s*(minutes?|min|heures?|h)\b(?:\s*(?:et\s*)?(demie?|30|15|quart))?/);
    if (!m) m = t.match(/(?:pendant|duree(?: de)?)\s+(\d+)\s*h\s*(\d{2})/);
    if (!m) return null;
    let n = /^\d+$/.test(m[1]) ? +m[1] : NOMBRES[m[1]];
    if (m[2] && /^\d{2}$/.test(m[2])) return n * 60 + +m[2];
    let mins = /^h|heure/.test(m[2]) ? n * 60 : n;
    if (m[3]) mins += /quart|15/.test(m[3]) ? 15 : 30;
    return mins;
  }

  // ---------- dates ----------
  function parseDate(t, now) {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    let m;
    if (/apres-demain|apres demain/.test(t)) return addD(d0, 2);
    if (/\bdemain\b/.test(t)) return addD(d0, 1);
    if (/aujourd'hui|aujourdhui|ce (?:matin|midi|soir|apres-midi)|\btantot\b/.test(t)) return d0;
    if ((m = t.match(/\b(\d{1,2}|1er|premier)\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?/))) {
      const day = /1er|premier/.test(m[1]) ? 1 : +m[1];
      const mo = MOIS_N.indexOf(m[2]);
      let y = m[3] ? +m[3] : d0.getFullYear();
      let d = new Date(y, mo, day);
      if (!m[3] && d < addD(d0, -1)) d = new Date(y + 1, mo, day);
      return d;
    }
    if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : d0.getFullYear();
      let d = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && d < addD(d0, -1)) d = new Date(y + 1, +m[2] - 1, +m[1]);
      return d;
    }
    if ((m = t.match(/\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b(\s+prochain)?/))) {
      const wd = JOURS_N.indexOf(m[1]);
      let diff = (wd - d0.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (m[2] && diff < 7 && /semaine prochaine/.test(t)) diff += 7;
      return addD(d0, diff);
    }
    if ((m = t.match(/\ble\s+(\d{1,2}|1er|premier)\b(?!\s*(?:h|:|heures?|minutes?))/))) {
      const day = /1er|premier/.test(m[1]) ? 1 : +m[1];
      let d = new Date(d0.getFullYear(), d0.getMonth(), day);
      if (d < d0) d = new Date(d0.getFullYear(), d0.getMonth() + 1, day);
      return d;
    }
    return null;
  }
  function addD(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  // ---------- contacts ----------
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function findContact(text) {
    if (!window.CRM || !CRM._all) return null;
    const t = ' ' + strip(text).replace(/[^a-z0-9' -]/g, ' ') + ' ';
    const all = Object.values(CRM._all()).filter(c => !c.deleted && c.name);
    let best = null, bestScore = 0;
    all.forEach(c => {
      const n = strip(c.name).replace(/[^a-z0-9' -]/g, ' ').trim();
      const parts = n.split(/\s+/).filter(p => p.length > 1);
      let score = 0;
      if (t.includes(' ' + n + ' ')) score = 10;
      else {
        const words = t.trim().split(/\s+/);
        const near = (p) => t.includes(' ' + p + ' ') || (p.length >= 5 && words.some(w => Math.abs(w.length - p.length) <= 1 && lev(w, p) <= 1));
        const hits = parts.filter(near);
        if (hits.length === parts.length && parts.length > 1) score = 8;
        else if (hits.length) score = hits.some(p => p === parts[parts.length - 1]) ? 4 : 3;
      }
      if (score > bestScore) { best = c; bestScore = score; }
      else if (score === bestScore && score > 0 && score < 8) best = null; // ambigu
    });
    return bestScore >= 3 ? best : null;
  }

  // ---------- analyse complète ----------
  function parseCommand(raw, now = new Date()) {
    const original = String(raw || '').trim();
    const t = strip(original);
    const out = { raw: original, date: null, start: null, end: null, duration: null, title: '', contact: null, type: null, location: '', allDay: false };

    out.date = parseDate(t, now);
    let m;
    const range = new RegExp(`(?:de|entre)\\s+${TIME_RX}\\s+(?:a|jusqu'a|et)\\s+${TIME_RX}`);
    if ((m = t.match(range))) { out.start = parseTime(m[1]); out.end = parseTime(m[2]); }
    else if ((m = t.match(new RegExp(`(?:a|vers|pour)\\s+${TIME_RX}`)))) out.start = parseTime(m[1]);
    else if ((m = t.match(new RegExp(`\\b${TIME_RX}`)))) out.start = parseTime(m[1]);
    if (out.start != null && out.end != null && out.end <= out.start && out.end + 720 > out.start) out.end += 720;
    out.duration = out.end != null && out.start != null ? out.end - out.start : parseDuration(t);
    if (/toute la journee|journee complete/.test(t)) out.allDay = true;

    // titre : « titre … », « intitulé … », « appelé … », « qui s'appelle … »
    const tm = original.match(/(?:avec (?:le|comme) titre|titre|intitul[ée]e?|appelée?(?=\s)|qui s'appelle|nomm[ée]e?(?=\s))\s*[:«"]?\s*(.+?)(?:[»"]|[.,;]|\s+(?:avec|pour le client|pour la cliente|le\s+\d|demain|aujourd|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|de\s+\d|de midi|à\s+\d|a\s+\d)\b|$)/i);
    if (tm) out.title = tm[1].trim();

    // lieu : « au 4521 rue Fabre », « à l'adresse … »
    const lm = original.match(/(?:à l'adresse|a l'adresse|au|adresse)\s+(\d+[^,.;]*?(?:rue|avenue|av\.?|boulevard|boul\.?|chemin|ch\.?|place|rang|montée|croissant)(?:\s+[^,.;]+?)??)(?=[,.;]|\s+(?:avec|pour|le\s+\d|titre|de\s+\d|à\s+\d)\b|$)/i);
    if (lm) out.location = lm[1].trim();

    out.contact = findContact(original);

    // type
    const rules = [['visite', /visite|showing/], ['appel', /appel|appeler|telephon|rappel/], ['docs', /notaire|signature|document|compta|\bged\b|inspection|financement/],
      ['marketing', /marketing|photo|video|instagram|facebook|publicit/], ['urgent', /urgent/], ['matrix', /matrix|tache|recherche/],
      ['reunion', /rencontre|rendez-vous|rdv|reunion|meeting|cafe|diner|lunch/]];
    const typeText = strip(out.title) || t;
    for (const [k, rx] of rules) if (rx.test(typeText)) { out.type = k; break; }
    if (!out.type) for (const [k, rx] of rules) if (rx.test(t)) { out.type = k; break; }
    out.type = out.type || 'reunion';

    if (!out.title) {
      const lbl = { visite: 'Visite', appel: 'Appel', docs: 'Signature / documents', marketing: 'Marketing', urgent: 'Urgent', matrix: 'Tâche', reunion: 'Rencontre client' }[out.type];
      out.title = out.contact ? `${lbl} – ${out.contact.name}` : lbl;
    } else if (out.contact && !strip(out.title).includes(strip(out.contact.name.split(' ')[0]))) {
      out.title = `${out.title.charAt(0).toUpperCase()}${out.title.slice(1)} – ${out.contact.name}`;
    } else out.title = out.title.charAt(0).toUpperCase() + out.title.slice(1);
    return out;
  }

  // ---------- interface ----------
  const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  let rec = null, listening = false, gotResult = false, watchdog = null;
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const useSR = () => !IOS && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  function keyboardMode(msg) {
    const ta = document.getElementById('voice-text'), hint = document.getElementById('voice-hint'), btn = document.getElementById('voice-mic');
    if (btn) btn.classList.remove('on');
    if (hint) hint.innerHTML = msg || '👇 Touchez le <b>🎤 du clavier</b> (en bas à droite du clavier) et parlez. Touchez <b>OK</b> quand c\'est fini.';
    if (ta) ta.focus();
  }

  function sheet() {
    let m = document.getElementById('voice-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'voice-modal'; m.className = 'modal';
    m.addEventListener('click', ev => { if (ev.target === m) Voice.close(); });
    m.innerHTML = `<div class="sheet voice-sheet">
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="Voice.close()">✕</button><b>Dites-le à votre Motherboard</b><span style="width:60px"></span></div>
      <button type="button" id="voice-mic" class="voice-mic" onclick="Voice.toggle()">🎤</button>
      <div id="voice-hint" class="voice-hint">Touchez le micro et parlez.</div>
      <textarea id="voice-text" rows="4" autocomplete="off" autocorrect="on" spellcheck="false" placeholder="Ex. : Ajoute-moi un rendez-vous demain de midi à midi et demi avec Marc Tremblay, titre rencontre client"></textarea>
      <div id="voice-preview" class="voice-preview"></div>
      <button type="button" class="sheet-save voice-go" onclick="Voice.go()">Préparer le rendez-vous</button>
      <div class="voice-ex">Exemples :<br>• « Visite vendredi à 14 h au 4521 rue Fabre avec Marc Tremblay »<br>• « Appel avec Sophie Roy le 15 octobre à 10 h pendant 15 minutes »<br>• « Rendez-vous lundi de 9 h à 10 h 30, titre signature notaire »</div>
    </div>`;
    document.body.appendChild(m);
    const ta = m.querySelector('#voice-text');
    ['input', 'change', 'keyup', 'paste', 'compositionend'].forEach(e => ta.addEventListener(e, () => setTimeout(preview, 0)));
    let last = '';
    setInterval(() => { const mm = document.getElementById('voice-modal'); if (mm && mm.classList.contains('open') && ta.value !== last) { last = ta.value; preview(); } }, 500);
    ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); Voice.go(); } });
    ta.setAttribute('enterkeyhint', 'go');
    return m;
  }

  function preview() {
    const txt = document.getElementById('voice-text').value;
    const box = document.getElementById('voice-preview');
    if (!txt.trim()) { box.innerHTML = ''; return; }
    const p = parseCommand(txt);
    const date = p.date ? p.date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }) : '<i>date ? (aujourd\'hui par défaut)</i>';
    const time = p.allDay ? 'toute la journée' : p.start != null ? `${fmtMin(p.start)}${p.duration ? ' – ' + fmtMin(p.start + p.duration) : ''}` : '<i>heure ?</i>';
    box.innerHTML = `<div><span>Titre</span><b>${esc(p.title)}</b></div><div><span>Quand</span><b>${date} · ${time}</b></div>` +
      `<div><span>Client</span><b>${p.contact ? '👤 ' + esc(p.contact.name) : '<i>aucun contact reconnu</i>'}</b></div>` +
      (p.location ? `<div><span>Lieu</span><b>📍 ${esc(p.location)}</b></div>` : '');
  }

  function fillForm(p) {
    const now = new Date();
    const day = p.date || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(day);
    if (p.start != null) start.setHours(Math.floor(p.start / 60), p.start % 60, 0, 0);
    else start.setHours(9, 0, 0, 0);
    if (typeof openAddForm !== 'function') return;
    openAddForm(start);
    const f = document.getElementById('add-form'); if (!f) return;
    f.querySelector('[name=title]').value = p.title;
    if (p.location) f.querySelector('[name=location]').value = p.location;
    else if (p.contact && p.contact.address && p.type !== 'appel') f.querySelector('[name=location]').value = p.contact.address;
    if (p.allDay) { f.querySelector('[name=allday]').checked = true; toggleAllDay(); }
    if (typeof setFormType === 'function') setFormType(p.type);
    if (typeof setFormDur === 'function') setFormDur(p.duration && p.duration > 0 ? p.duration : 60);
    window.pendingContactId = p.contact ? p.contact.id : null;
    const msg = document.getElementById('add-msg');
    if (msg && !msg.textContent) { msg.style.color = '#2E7D32'; msg.textContent = `🎤 Compris ! Vérifiez puis touchez « Enregistrer ».${p.start == null ? ' (Heure non reconnue : 9 h par défaut.)' : ''}`; }
    setTimeout(() => { if (msg) msg.style.color = ''; }, 8000);
  }

  window.Voice = {
    parse: parseCommand,
    open() {
      const m = sheet(); m.classList.add('open');
      document.getElementById('voice-text').value = ''; preview();
      if (useSR()) { document.getElementById('voice-hint').textContent = 'Touchez le micro et parlez.'; Voice.toggle(); }
      else keyboardMode(); // iPhone : la dictée du clavier est la plus fiable (et le clavier s'ouvre tout de suite)
    },
    close() {
      if (rec && listening) try { rec.stop(); } catch (e) {}
      const m = document.getElementById('voice-modal'); if (m) m.classList.remove('open');
    },
    toggle() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const hint = document.getElementById('voice-hint'), btn = document.getElementById('voice-mic'), ta = document.getElementById('voice-text');
      if (!useSR()) { ta.focus(); keyboardMode(); return; }
      if (listening) { try { rec.stop(); } catch (e) {} return; }
      rec = new SR(); rec.lang = 'fr-CA'; rec.interimResults = true; rec.continuous = false;
      const base = ta.value ? ta.value + ' ' : '';
      rec.onresult = (ev) => { gotResult = true; let s = ''; for (let i = 0; i < ev.results.length; i++) s += ev.results[i][0].transcript; ta.value = base + s; preview(); };
      rec.onerror = (ev) => {
        hint.textContent = ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
          ? 'Micro refusé : autorisez-le dans les réglages, ou utilisez le 🎤 du clavier.'
          : 'Je n\'ai pas bien entendu. Réessayez, ou tapez/dictez avec le clavier.';
      };
      rec.onend = () => {
        clearTimeout(watchdog);
        listening = false; btn.classList.remove('on');
        if (!gotResult && !ta.value.trim()) { keyboardMode('Le micro de l\'app n\'a rien capté. Touchez le <b>🎤 du clavier</b> et parlez.'); return; }
        if (ta.value.trim() && hint.textContent.startsWith('J\'écoute')) { hint.textContent = 'Vérifiez ci-dessous, puis « Préparer le rendez-vous ».'; }
      };
      gotResult = false;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { if (listening && !gotResult) { try { rec.abort(); } catch (e) {} } }, 7000);
      try { rec.start(); listening = true; btn.classList.add('on'); hint.textContent = 'J\'écoute… parlez maintenant.'; }
      catch (e) { hint.textContent = 'Touchez la zone de texte, puis le 🎤 du clavier pour dicter.'; ta.focus(); }
    },
    go() {
      const txt = document.getElementById('voice-text').value;
      if (!txt.trim()) { document.getElementById('voice-hint').textContent = 'Dites ou tapez votre demande d\'abord.'; return; }
      const p = parseCommand(txt);
      if (typeof accessToken !== 'undefined' && !accessToken && typeof getServerToken === 'function') {
        document.getElementById('voice-hint').textContent = 'Connexion à Google…';
        getServerToken().then(ok => {
          if (!ok) { document.getElementById('voice-hint').innerHTML = 'Google n\'est pas connecté sur cet appareil. <a href="/api/auth/start">Touchez ici pour connecter Google</a>, puis réessayez.'; return; }
          Voice.close(); fillForm(p);
        });
        return;
      }
      Voice.close();
      fillForm(p);
    }
  };
})();

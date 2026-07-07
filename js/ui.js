// ===== רדיולי — ממשק =====
(function () {
  const $ = (id) => document.getElementById(id);
  const icon = (name, cls) => '<svg class="ic ' + (cls || '') + '"><use href="#i-' + name + '"/></svg>';

  const PHASE_LABELS = {
    off: { text: 'כבוי', cls: '' },
    announce: { text: '🕰️ הכרזת שעה', cls: 'live' },
    news: { text: '📰 חדשות', cls: 'news' },
    talk: { text: '🗣️ דיבורים', cls: 'live' },
    song: { text: '🎵 שיר', cls: 'live' },
    live: { text: '🔴 שידור חי', cls: 'news' },
  };

  const ROLE_LABELS = { music: '🎵 מוזיקה', talk: '🗣️ דיבורים', news: '📰 חדשות' };

  // ---- טוסט ----
  let toastTimer;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  // ---- שעון (שעון ישראל) ----
  function tickClock() {
    const t = Engine.ilTime();
    $('clock').textContent = String(t.h).padStart(2, '0') + ':' + String(t.m).padStart(2, '0');
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ---- אנימציית הרדיו בחוגה ----
  if (window.lottie) {
    try {
      lottie.loadAnimation({
        container: $('dialAnim'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'RADIOANIM.json',
      });
    } catch (e) { console.warn('lottie failed', e); $('dialAnim').textContent = '📻'; }
  } else {
    $('dialAnim').textContent = '📻';
  }

  // ---- מעבר מסכים ----
  function showView(name) {
    $('viewRadio').hidden = name !== 'radio';
    $('viewSettings').hidden = name !== 'settings';
    window.scrollTo({ top: 0 });
  }
  // גלגל השיניים הוא מתג: לחיצה נוספת חוזרת לרדיו; גם הלוגו מוביל הביתה
  $('btnSettings').onclick = () => {
    if ($('viewSettings').hidden) { showView('settings'); renderSettings(); }
    else showView('radio');
  };
  $('btnBackToRadio').onclick = () => showView('radio');
  $('logoHome').onclick = () => showView('radio');

  // עיגולי עזרה — לחיצה מציגה את ההסבר
  document.addEventListener('click', (e) => {
    const dot = e.target.closest('.help-dot');
    if (dot) toast(dot.dataset.help, 6000);
  });

  // ---- וילון הנגן ----
  const sheet = $('playerSheet');
  $('sheetHandle').onclick = () => sheet.classList.toggle('collapsed');
  $('btnCollapse').onclick = () => sheet.classList.toggle('collapsed');
  $('miniRow').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    sheet.classList.toggle('collapsed');
  });

  // ---- מצבי רוח (בפס העליון וגם בתוך הנגן) ----
  function renderMoodChips(container, small) {
    container.innerHTML = '';
    const mkChip = (label, active, onClick) => {
      const b = document.createElement('button');
      b.className = 'mood-chip' + (active ? ' active' : '');
      b.textContent = label;
      b.onclick = onClick;
      container.appendChild(b);
    };
    mkChip('🎧 הכול', !Store.data.activeMood, () => { Store.setActiveMood(null); Engine.onMoodChanged(); });
    Store.data.moods.forEach(m => {
      mkChip(m.emoji + ' ' + m.name, Store.data.activeMood === m.id, () => {
        Store.setActiveMood(m.id);
        Engine.onMoodChanged();
        toast('עברנו למצב רוח: ' + m.emoji + ' ' + m.name);
      });
    });
  }
  function renderMoodBar() {
    renderMoodChips($('moodBar'));
    renderMoodChips($('sheetMoods'), true);
  }

  // ---- ערוצים (בעמוד הראשי) ----
  function renderChannels() {
    const list = $('channelList');
    list.innerHTML = '';
    if (!Store.data.channels.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'עוד אין ערוצים 🙈 מדביקים למעלה קישור מיוטיוב';
      list.appendChild(li);
      return;
    }
    Store.data.channels.forEach(ch => {
      const li = document.createElement('li');
      li.className = 'channel-item';

      const row1 = document.createElement('div');
      row1.className = 'row1';

      const title = document.createElement('span');
      title.className = 'ch-title';
      title.textContent = (ch.kind === 'playlist' ? '📃 ' : '') + (ch.title || ch.ytId);

      const role = document.createElement('select');
      role.className = 'ch-role';
      Object.entries(ROLE_LABELS).forEach(([val, label]) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        if (ch.role === val) opt.selected = true;
        role.appendChild(opt);
      });
      role.onchange = () => Store.updateChannel(ch.key, { role: role.value });

      const del = document.createElement('button');
      del.className = 'ch-del';
      del.title = 'מחיקה';
      del.innerHTML = icon('trash');
      del.onclick = () => { if (confirm('למחוק את "' + (ch.title || ch.ytId) + '"?')) Store.removeChannel(ch.key); };

      row1.append(title, role, del);
      li.appendChild(row1);

      if (Store.data.moods.length) {
        const moodsRow = document.createElement('div');
        moodsRow.className = 'ch-moods';
        Store.data.moods.forEach(m => {
          const tag = document.createElement('button');
          tag.type = 'button';
          tag.className = 'ch-mood-tag' + (ch.moodIds.includes(m.id) ? ' on' : '');
          tag.textContent = m.emoji + ' ' + m.name;
          tag.onclick = () => Store.toggleChannelMood(ch.key, m.id);
          moodsRow.appendChild(tag);
        });
        li.appendChild(moodsRow);
      }

      list.appendChild(li);
    });
  }

  $('addChannelForm').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('channelInput');
    const btn = $('btnAddChannel');
    const statusEl = $('addStatus');
    const text = input.value.trim();
    if (!text) return;

    const parsed = YTBridge.parseInput(text);
    if (!parsed) { statusEl.textContent = 'לא הצלחתי להבין את הקישור 😅 נסי קישור לערוץ, לפלייליסט או @כינוי'; return; }

    btn.disabled = true;
    statusEl.textContent = 'בודקת את הערוץ…';
    try {
      let resolved = parsed;
      if (parsed.kind === 'handle') resolved = await YTBridge.resolveHandle(parsed);

      const dup = Store.data.channels.find(c => c.ytId === resolved.ytId);
      if (dup) { statusEl.textContent = 'הערוץ הזה כבר ברשימה 🙂'; btn.disabled = false; return; }

      const feed = await YTBridge.fetchFeed(resolved.kind, resolved.ytId);
      if (!feed.videos.length) throw new Error('לא נמצאו סרטונים בערוץ');

      Store.addChannel({
        ytId: resolved.ytId,
        kind: resolved.kind,
        title: feed.title || resolved.title || text,
        role: $('channelRole').value,
      });
      input.value = '';
      statusEl.textContent = '';
      toast('נוסף: ' + (feed.title || text) + ' ✨');
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'לא הצלחתי להוסיף 😢 ' + (err.message && err.message.length < 80 ? err.message : 'בדקי את הקישור ונסי שוב');
    }
    btn.disabled = false;
  };

  // ---- מצבי רוח (ניהול בהגדרות) ----
  function renderMoods() {
    const list = $('moodList');
    list.innerHTML = '';
    const s = Store.data.settings;
    Store.data.moods.forEach(m => {
      const li = document.createElement('li');
      li.className = 'mood-item';

      const row1 = document.createElement('div');
      row1.className = 'm-row1';
      const emoji = document.createElement('span');
      emoji.textContent = m.emoji;
      const name = document.createElement('span');
      name.className = 'm-name';
      name.textContent = m.name;
      const del = document.createElement('button');
      del.className = 'm-del';
      del.innerHTML = icon('trash');
      del.onclick = () => { if (confirm('למחוק את מצב הרוח "' + m.name + '"?')) Store.removeMood(m.id); };
      row1.append(emoji, name, del);
      li.appendChild(row1);

      // נוסחת השידור של מצב הרוח
      const r = m.recipe || {};
      const recipe = document.createElement('div');
      recipe.className = 'm-recipe';

      const mkNum = (label, val, max, onChange) => {
        const wrap = document.createElement('label');
        wrap.className = 'm-recipe-item';
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = 0; inp.max = max;
        inp.value = val;
        inp.onchange = () => onChange(Math.max(0, Math.min(max, +inp.value || 0)));
        wrap.append(document.createTextNode(label + ' '), inp);
        return wrap;
      };
      const mkChk = (label, val, onChange) => {
        const wrap = document.createElement('label');
        wrap.className = 'm-recipe-item';
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.checked = val;
        inp.onchange = () => onChange(inp.checked);
        wrap.append(inp, document.createTextNode(' ' + label));
        return wrap;
      };
      const save = (patch) => {
        const cur = Object.assign({
          talkMin: r.talkMin != null ? r.talkMin : s.talkMinutes,
          songs: r.songs != null ? r.songs : 1,
          news: r.news != null ? r.news : s.newsEnabled,
          announce: r.announce != null ? r.announce : s.announceHour,
        }, patch);
        Store.updateMoodRecipe(m.id, cur);
      };

      recipe.append(
        mkNum('🗣️ דק\'', r.talkMin != null ? r.talkMin : s.talkMinutes, 90, v => save({ talkMin: v })),
        mkNum('🎵 שירים', r.songs != null ? r.songs : 1, 20, v => save({ songs: v })),
        mkChk('📰', r.news != null ? r.news : s.newsEnabled, v => save({ news: v })),
        mkChk('🕰️', r.announce != null ? r.announce : s.announceHour, v => save({ announce: v })),
      );
      li.appendChild(recipe);

      list.appendChild(li);
    });
  }

  $('addMoodForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('moodName').value.trim();
    if (!name) return;
    Store.addMood(name, $('moodEmoji').value.trim());
    $('moodName').value = '';
    $('moodEmoji').value = '';
  };

  // ---- תוכניות קבועות ----
  function renderPrograms() {
    const list = $('programList');
    if (!list) return;
    list.innerHTML = '';
    const progs = Store.data.programs || [];
    if (!progs.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'אין תוכניות קבועות. אפשר להוסיף שידור חי שייפתח אוטומטית בשעה שתקבעי.';
      list.appendChild(li);
      return;
    }
    progs.forEach(p => {
      const li = document.createElement('li');
      li.className = 'program-item';
      const time = document.createElement('span');
      time.className = 'p-time';
      time.textContent = String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
      const info = document.createElement('span');
      info.className = 'p-info';
      const dur = p.durationMin ? p.durationMin + ' דק\'' : 'עד סוף השידור';
      info.innerHTML = '<b>' + (p.title || p.ytId) + '</b><br><small>🔴 שידור חי · ' + dur + ' · כל יום</small>';
      const del = document.createElement('button');
      del.className = 'p-del';
      del.innerHTML = icon('trash');
      del.onclick = () => { if (confirm('למחוק את התוכנית "' + (p.title || '') + '"?')) Store.removeProgram(p.id); };
      li.append(time, info, del);
      list.appendChild(li);
    });
  }

  $('addProgramForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('progInput').value.trim();
    const timeVal = $('progTime').value;
    const btn = $('btnAddProgram');
    const statusEl = $('progStatus');
    if (!text || !timeVal) return;

    const parsed = YTBridge.parseInput(text);
    if (!parsed) { statusEl.textContent = 'לא הצלחתי להבין את הקישור 😅'; return; }

    btn.disabled = true;
    statusEl.textContent = 'בודקת את הערוץ…';
    try {
      let resolved = parsed;
      if (parsed.kind === 'handle') resolved = await YTBridge.resolveHandle(parsed);
      if (resolved.kind !== 'channel' || !resolved.ytId) throw new Error('צריך ערוץ (לא פלייליסט)');

      let title = resolved.title || '';
      if (!title) {
        try { const feed = await YTBridge.fetchFeed('channel', resolved.ytId); title = feed.title || ''; } catch (e) {}
      }
      const [h, m] = timeVal.split(':').map(Number);
      Store.addProgram({
        ytId: resolved.ytId,
        title: title || text,
        hour: h, minute: m,
        durationMin: Math.max(0, Math.min(240, +$('progDur').value || 60)),
      });
      $('progInput').value = '';
      statusEl.textContent = '';
      toast('נוספה תוכנית: ' + (title || text) + ' 📅');
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'לא הצלחתי להוסיף 😢 ' + (err.message && err.message.length < 60 ? err.message : 'בדקי את הקישור');
    }
    btn.disabled = false;
  };

  // ---- הגדרות כלליות ----
  function renderSettings() {
    renderMoods();
    renderPrograms();
    const s = Store.data.settings;
    $('setAnnounce').checked = s.announceHour;
    $('setNews').checked = s.newsEnabled;
    $('setTalkMin').value = s.talkMinutes;
    $('setNewsMin').value = s.newsMinutes;
    $('setSkipShorts').checked = s.skipShorts;
    $('setSongMin').value = s.songMinutes;
    $('setIntroSkip').value = s.introSkipSeconds;
    $('setAnnounceSound').value = s.announceSound;
    $('setTransSound').value = s.transitionSoundName;
    renderAccount();
  }

  $('setAnnounce').onchange = (e) => Store.setSetting('announceHour', e.target.checked);
  $('setNews').onchange = (e) => Store.setSetting('newsEnabled', e.target.checked);
  $('setTalkMin').onchange = (e) => Store.setSetting('talkMinutes', Math.max(3, Math.min(60, +e.target.value || 15)));
  $('setNewsMin').onchange = (e) => Store.setSetting('newsMinutes', Math.max(1, Math.min(60, +e.target.value || 5)));
  $('setSongMin').onchange = (e) => Store.setSetting('songMinutes', Math.max(1, Math.min(30, +e.target.value || 5)));
  $('setIntroSkip').onchange = (e) => Store.setSetting('introSkipSeconds', Math.max(0, Math.min(120, +e.target.value || 0)));
  $('setSkipShorts').onchange = (e) => Store.setSetting('skipShorts', e.target.checked);
  $('setAnnounceSound').onchange = (e) => Store.setSetting('announceSound', e.target.value);
  $('setTransSound').onchange = (e) => Store.setSetting('transitionSoundName', e.target.value);
  $('prevAnnounceSound').onclick = () => Engine.previewSound($('setAnnounceSound').value);
  $('prevTransSound').onclick = () => Engine.previewSound($('setTransSound').value);

  // ---- חשבון: כפתור בפינה + שורת התנתקות בהגדרות ----
  function renderAccount() {
    const btn = $('btnAccount');
    const user = Store.user;
    if (user) {
      btn.classList.add('logged-in');
      btn.title = 'מחוברת: ' + (user.displayName || user.email);
      if (user.photoURL) {
        btn.style.backgroundImage = 'url("' + user.photoURL + '")';
        btn.innerHTML = '';
      }
      $('rowLogout').hidden = false;
      $('logoutName').textContent = '☁️ מחוברת: ' + (user.displayName || user.email);
    } else {
      btn.classList.remove('logged-in');
      btn.style.backgroundImage = '';
      btn.innerHTML = icon('user');
      btn.title = 'התחברות עם Google';
      $('rowLogout').hidden = true;
    }
  }

  $('btnAccount').onclick = async () => {
    if (!Store.firebaseAvailable) {
      toast('סנכרון בענן לא מוגדר עדיין (ראי README) — הכול נשמר על המכשיר 💾');
      return;
    }
    if (Store.user) {
      toast('☁️ מחוברת בתור ' + (Store.user.displayName || Store.user.email) + ' — התנתקות דרך ההגדרות');
    } else {
      try {
        await Store.login();
        toast('מחוברת! הרדיו שלך מסונכרן בענן ☁️');
      } catch (e) {
        console.error(e);
        toast('ההתחברות נכשלה 😢 נסי שוב');
      }
    }
  };

  $('btnLogout').onclick = async () => {
    await Store.logout();
    renderAccount();
    toast('התנתקת. הנתונים נשארים גם על המכשיר 💾');
  };

  // ---- חיבור למנוע ----
  Engine.ui.onPhase = (p) => {
    const info = PHASE_LABELS[p] || PHASE_LABELS.off;
    const chip = $('phaseChip');
    chip.textContent = info.text;
    chip.className = 'phase-chip ' + info.cls;
    const btn = $('btnPower');
    const iconEl = $('powerIcon');
    if (p === 'off') {
      btn.classList.remove('on');
      iconEl.innerHTML = icon('play', 'ic-lg');
      $('npTitle').textContent = 'רדיולי מחכה לך 🌸';
      $('npChannel').textContent = '';
      $('playerCover').classList.remove('hidden');
      $('btnPause').hidden = true;
    } else {
      btn.classList.add('on');
      iconEl.innerHTML = icon('power', 'ic-lg');
      $('playerCover').classList.add('hidden');
      $('btnPause').hidden = false;
    }
  };

  Engine.ui.onPaused = (paused) => {
    const b = $('btnPause');
    b.innerHTML = icon(paused ? 'play' : 'pause');
    b.title = paused ? 'המשך' : 'השהיה';
    b.classList.toggle('is-paused', paused);
  };

  Engine.ui.onTrack = (v) => {
    if (!v) return;
    $('npTitle').textContent = v.title || '';
    $('npChannel').textContent = v.channelTitle || '';
  };

  Engine.ui.onStatus = (msg) => { $('engineStatus').textContent = msg; };

  $('btnPower').onclick = async () => {
    if (Engine.on) {
      Engine.powerOff();
    } else {
      if (!Store.data.channels.length) {
        toast('קודם מוסיפים ערוצים 🙂');
        showView('radio');
        $('channelInput').focus();
        return;
      }
      sheet.classList.remove('collapsed');
      await Engine.powerOn();
    }
  };
  $('btnPause').onclick = () => Engine.togglePause();
  $('btnSkip').onclick = () => Engine.skip();
  $('btnBanNow').onclick = () => Engine.banNow();
  $('btnSongNow').onclick = () => Engine.songNow();
  $('btnTalkNow').onclick = () => Engine.talkNow();
  $('btnNewsNow').onclick = () => Engine.newsNow();
  $('btnResetBlocked').onclick = () => { Engine.resetBlocked(); toast('החסימות אופסו — כל הסרטונים יקבלו צ\'אנס נוסף ✨'); };
  $('btnResetHeard').onclick = () => { Engine.resetHeard(); toast('היסטוריית ההאזנה אופסה 🌀'); };

  // ---- מצב תצוגת וידאו: רגיל ← קטן ← האזנה בלבד ----
  const VIDEO_MODES = [
    { id: 'normal', icon: 'monitor', label: 'וידאו' },
    { id: 'mini', icon: 'mini', label: 'וידאו קטן' },
    { id: 'audio', icon: 'headphones', label: 'האזנה בלבד' },
  ];
  function applyVideoMode() {
    const mode = Store.data.settings.videoMode || 'normal';
    const def = VIDEO_MODES.find(m => m.id === mode) || VIDEO_MODES[0];
    const wrap = $('playerWrap');
    wrap.classList.toggle('mode-mini', mode === 'mini');
    wrap.classList.toggle('mode-audio', mode === 'audio');
    $('audioNote').hidden = mode !== 'audio';
    $('btnVideoMode').innerHTML = icon(def.icon) + ' ' + def.label;
    if (mode !== 'normal') YTBridge.lowQuality();
  }
  $('btnVideoMode').onclick = () => {
    const cur = Store.data.settings.videoMode || 'normal';
    const next = VIDEO_MODES[(VIDEO_MODES.findIndex(m => m.id === cur) + 1) % VIDEO_MODES.length].id;
    Store.setSetting('videoMode', next);
    applyVideoMode();
  };
  applyVideoMode();

  // ---- רענון כללי כשמשהו משתנה ----
  Store.subscribe(() => {
    renderMoodBar();
    renderChannels();
    if (!$('viewSettings').hidden) renderSettings();
  });

  // ---- אתחול ----
  renderMoodBar();
  renderChannels();
  Store.initFirebase(() => renderAccount());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw failed', e));
  }
})();

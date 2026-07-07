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
  };

  const ROLE_LABELS = { music: '🎵 מוזיקה', talk: '🗣️ דיבורים', news: '📰 חדשות' };

  // ---- טוסט ----
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
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
  $('btnSettings').onclick = () => { showView('settings'); renderSettings(); };
  $('btnBackToRadio').onclick = () => showView('radio');

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
      li.textContent = 'עוד אין ערוצים 🙈 מדביקים למעלה קישור לערוץ או פלייליסט מיוטיוב — וזה כל מה שצריך כדי שהרדיו יעבוד.';
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
    Store.data.moods.forEach(m => {
      const li = document.createElement('li');
      li.className = 'mood-item';
      const emoji = document.createElement('span');
      emoji.textContent = m.emoji;
      const name = document.createElement('span');
      name.className = 'm-name';
      name.textContent = m.name;
      const del = document.createElement('button');
      del.className = 'm-del';
      del.innerHTML = icon('trash');
      del.onclick = () => { if (confirm('למחוק את מצב הרוח "' + m.name + '"?')) Store.removeMood(m.id); };
      li.append(emoji, name, del);
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

  // ---- הגדרות כלליות ----
  function renderSettings() {
    renderMoods();
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

  // ---- חשבון: רק דרך הכפתור בפינה ----
  function renderAccount() {
    const btn = $('btnAccount');
    const user = Store.user;
    if (user) {
      btn.classList.add('logged-in');
      btn.title = 'מחוברת: ' + (user.displayName || user.email) + ' — לחיצה להתנתקות';
      if (user.photoURL) {
        btn.style.backgroundImage = 'url("' + user.photoURL + '")';
        btn.innerHTML = '';
      }
    } else {
      btn.classList.remove('logged-in');
      btn.style.backgroundImage = '';
      btn.innerHTML = icon('user');
      btn.title = 'התחברות עם Google';
    }
  }

  $('btnAccount').onclick = async () => {
    if (!Store.firebaseAvailable) {
      toast('סנכרון בענן לא מוגדר עדיין (ראי README) — הכול נשמר על המכשיר 💾');
      return;
    }
    if (Store.user) {
      if (confirm('להתנתק מהחשבון של ' + (Store.user.displayName || Store.user.email) + '?')) {
        await Store.logout();
        toast('התנתקת. הנתונים נשארים גם על המכשיר 💾');
      }
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
    } else {
      btn.classList.add('on');
      iconEl.innerHTML = icon('power', 'ic-lg');
      $('playerCover').classList.add('hidden');
    }
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
  $('btnSkip').onclick = () => Engine.skip();
  $('btnSongNow').onclick = () => Engine.songNow();
  $('btnTalkNow').onclick = () => Engine.talkNow();
  $('btnNewsNow').onclick = () => Engine.newsNow();

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

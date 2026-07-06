// ===== רדיולי — ממשק =====
(function () {
  const $ = (id) => document.getElementById(id);

  const PHASE_LABELS = {
    off: { text: 'כבוי', cls: '' },
    announce: { text: '🕰️ כרוזת שעה', cls: 'live' },
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

  // ---- מעבר מסכים ----
  function showView(name) {
    $('viewRadio').hidden = name !== 'radio';
    $('viewSettings').hidden = name !== 'settings';
    window.scrollTo({ top: 0 });
  }
  $('btnSettings').onclick = () => { showView('settings'); renderSettings(); };
  $('btnBackToRadio').onclick = () => showView('radio');
  $('btnGoAddChannels').onclick = () => { showView('settings'); renderSettings(); $('channelInput').focus(); };
  $('btnAccount').onclick = () => { showView('settings'); renderSettings(); $('accountBox').scrollIntoView({ behavior: 'smooth' }); };

  // ---- וילון הנגן ----
  const sheet = $('playerSheet');
  $('sheetHandle').onclick = () => sheet.classList.toggle('collapsed');
  $('miniRow').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    sheet.classList.toggle('collapsed');
  });

  // ---- מצבי רוח ----
  function renderMoodBar() {
    const bar = $('moodBar');
    bar.innerHTML = '';
    const all = document.createElement('button');
    all.className = 'mood-chip' + (Store.data.activeMood ? '' : ' active');
    all.textContent = '🎧 הכול';
    all.onclick = () => { Store.setActiveMood(null); Engine.onMoodChanged(); };
    bar.appendChild(all);
    Store.data.moods.forEach(m => {
      const b = document.createElement('button');
      b.className = 'mood-chip' + (Store.data.activeMood === m.id ? ' active' : '');
      b.textContent = m.emoji + ' ' + m.name;
      b.onclick = () => { Store.setActiveMood(m.id); Engine.onMoodChanged(); toast('עברנו למצב רוח: ' + m.emoji + ' ' + m.name); };
      bar.appendChild(b);
    });
  }

  // ---- מסך רדיו ----
  function renderHero() {
    $('heroEmpty').hidden = Store.data.channels.length > 0;
  }

  // ---- הגדרות: ערוצים ----
  function renderChannels() {
    const list = $('channelList');
    list.innerHTML = '';
    if (!Store.data.channels.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'עוד אין ערוצים. אפשר להדביק למעלה קישור לכל ערוץ או פלייליסט מיוטיוב.';
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
      del.textContent = '🗑️';
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

  // ---- הגדרות: מצבי רוח ----
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
      del.textContent = '🗑️';
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
    renderChannels();
    renderMoods();
    const s = Store.data.settings;
    $('setAnnounce').checked = s.announceHour;
    $('setNews').checked = s.newsEnabled;
    $('setTalkMin').value = s.talkMinutes;
    $('setNewsMin').value = s.newsMinutes;
    $('setSkipShorts').checked = s.skipShorts;
    $('setTransition').checked = s.transitionSound;
    renderAccount();
  }

  $('setAnnounce').onchange = (e) => Store.setSetting('announceHour', e.target.checked);
  $('setNews').onchange = (e) => Store.setSetting('newsEnabled', e.target.checked);
  $('setTalkMin').onchange = (e) => Store.setSetting('talkMinutes', Math.max(3, Math.min(60, +e.target.value || 15)));
  $('setNewsMin').onchange = (e) => Store.setSetting('newsMinutes', Math.max(1, Math.min(60, +e.target.value || 5)));
  $('setSkipShorts').onchange = (e) => Store.setSetting('skipShorts', e.target.checked);
  $('setTransition').onchange = (e) => Store.setSetting('transitionSound', e.target.checked);

  // ---- חשבון ----
  function renderAccount() {
    const hint = $('accountHint');
    const btnIn = $('btnLogin');
    const btnOut = $('btnLogout');
    if (!Store.firebaseAvailable) {
      hint.innerHTML = 'כרגע הכול נשמר על המכשיר הזה. כדי להתחבר עם Google ולסנכרן בין מכשירים — צריך לחבר פרויקט Firebase (ההסבר בקובץ README).';
      btnIn.hidden = true; btnOut.hidden = true;
      return;
    }
    if (Store.user) {
      hint.textContent = 'מחוברת בתור ' + (Store.user.displayName || Store.user.email) + ' — הערוצים ומצבי הרוח מסונכרנים בענן ☁️';
      btnIn.hidden = true; btnOut.hidden = false;
    } else {
      hint.textContent = 'אפשר להתחבר עם חשבון Google כדי לשמור את הרדיו שלך בענן ולשתף בין מכשירים.';
      btnIn.hidden = false; btnOut.hidden = true;
    }
  }
  $('btnLogin').onclick = () => Store.login().catch(e => toast('ההתחברות נכשלה 😢'));
  $('btnLogout').onclick = () => Store.logout();

  // ---- חיבור למנוע ----
  Engine.ui.onPhase = (p) => {
    const info = PHASE_LABELS[p] || PHASE_LABELS.off;
    const chip = $('phaseChip');
    chip.textContent = info.text;
    chip.className = 'phase-chip ' + info.cls;
    const btn = $('btnPower');
    const icon = $('powerIcon');
    if (p === 'off') {
      btn.classList.remove('on');
      icon.textContent = '▶';
      $('npTitle').textContent = 'רדיולי מחכה לך 🌸';
      $('npChannel').textContent = '';
      $('playerCover').classList.remove('hidden');
    } else {
      btn.classList.add('on');
      icon.textContent = '⏻';
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
        showView('settings'); renderSettings();
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
    { id: 'normal', label: '📺 וידאו' },
    { id: 'mini', label: '🔲 וידאו קטן' },
    { id: 'audio', label: '🎧 האזנה בלבד' },
  ];
  function applyVideoMode() {
    const mode = Store.data.settings.videoMode || 'normal';
    const wrap = $('playerWrap');
    wrap.classList.toggle('mode-mini', mode === 'mini');
    wrap.classList.toggle('mode-audio', mode === 'audio');
    $('audioNote').hidden = mode !== 'audio';
    $('btnVideoMode').textContent = VIDEO_MODES.find(m => m.id === mode).label;
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
    renderHero();
    if (!$('viewSettings').hidden) { renderChannels(); renderMoods(); renderAccount(); }
  });

  // ---- אתחול ----
  renderMoodBar();
  renderHero();
  Store.initFirebase(() => renderAccount());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw failed', e));
  }
})();

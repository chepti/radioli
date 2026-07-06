// ===== רדיולי — מנוע הרדיו: כרוזת שעה, חדשות, דיבורים, שירים =====
(function () {
  const POS_KEY = 'radioli-positions-v1';
  const BLOCKED_KEY = 'radioli-blocked-v1';

  const Engine = {
    on: false,
    phase: 'off', // off | announce | news | talk | song
    current: null,       // {videoId,title,channelTitle}
    currentTalk: null,   // הסרטון של מקטע הדיבורים (כדי לחזור אליו אחרי שיר/חדשות)
    talkDeadline: 0,
    newsDeadline: 0,
    lastBreakHour: -1,
    recent: [],
    positions: loadPositions(),
    blocked: loadBlocked(),
    errorStreak: 0,
    tickTimer: null,
    ui: { onPhase() {}, onTrack() {}, onStatus() {} },
  };

  function loadPositions() {
    try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePositions() {
    localStorage.setItem(POS_KEY, JSON.stringify(Engine.positions));
  }

  // סרטונים שאי אפשר לנגן מחוץ ליוטיוב (שגיאה 150/101) — נחסמים לתמיד
  function loadBlocked() {
    try { return JSON.parse(localStorage.getItem(BLOCKED_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function blockVideo(videoId) {
    if (!videoId) return;
    Engine.blocked[videoId] = true;
    localStorage.setItem(BLOCKED_KEY, JSON.stringify(Engine.blocked));
  }

  function status(msg) { Engine.ui.onStatus(msg || ''); }

  function setPhase(p) {
    Engine.phase = p;
    Engine.ui.onPhase(p);
  }

  function setTrack(v) {
    Engine.current = v;
    Engine.ui.onTrack(v);
  }

  function rememberRecent(videoId) {
    Engine.recent.push(videoId);
    if (Engine.recent.length > 25) Engine.recent.shift();
  }

  // ---- שעון ישראל ----
  // תמיד לפי Asia/Jerusalem, לא לפי שעון המכשיר — גם בחו"ל הרדיו בשעון ישראל.
  const IL_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  function ilTime() {
    const parts = IL_FMT.formatToParts(new Date());
    const get = (t) => +parts.find(p => p.type === t).value;
    return { h: get('hour') % 24, m: get('minute') };
  }
  Engine.ilTime = ilTime;

  // ---- הכרזת שעה ----
  const HOUR_WORDS = ['שתים עשרה', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר', 'אחת עשרה'];
  const UNIT_WORDS = ['', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'];
  const TEEN_WORDS = ['עשר', 'אחת עשרה', 'שתים עשרה', 'שלוש עשרה', 'ארבע עשרה', 'חמש עשרה', 'שש עשרה', 'שבע עשרה', 'שמונה עשרה', 'תשע עשרה'];
  const TENS_WORDS = { 20: 'עשרים', 30: 'שלושים', 40: 'ארבעים', 50: 'חמישים' };

  // מספר דקות במילים (נקבה): 22 -> "עשרים ושתיים"
  function minutesWords(m) {
    if (m < 10) return UNIT_WORDS[m];
    if (m < 20) return TEEN_WORDS[m - 10];
    const tens = Math.floor(m / 10) * 10;
    const unit = m % 10;
    return TENS_WORDS[tens] + (unit ? ' ו' + UNIT_WORDS[unit] : '');
  }

  function timePhrase() {
    const t = ilTime();
    const h = HOUR_WORDS[t.h % 12];
    const m = t.m;
    let suffix = '';
    if (m === 0) suffix = ' בדיוק';
    else if (m === 15) suffix = ' ורבע';
    else if (m === 30) suffix = ' וחצי';
    else if (m === 1) suffix = ' ודקה';
    else if (m === 2) suffix = ' ושתי דקות';
    else suffix = ' ו' + minutesWords(m) + ' דקות';
    const part = t.h < 5 ? 'בלילה' : t.h < 12 ? 'בבוקר' : t.h < 17 ? 'אחר הצהריים' : t.h < 21 ? 'בערב' : 'בלילה';
    return 'כאן רדיולי. השעה ' + h + suffix + ' ' + part + '.';
  }

  // ---- ערכות צלילים ----
  const SOUND_THEMES = {
    bells:   { wave: 'sine',     notes: [523.25, 659.25, 783.99],        gap: 0.35, len: 0.6,  gain: 0.25 },
    harp:    { wave: 'triangle', notes: [392, 523.25, 659.25, 783.99],   gap: 0.16, len: 0.9,  gain: 0.18 },
    marimba: { wave: 'sine',     notes: [880, 659.25, 523.25, 659.25],   gap: 0.2,  len: 0.3,  gain: 0.22 },
    soft:    { wave: 'sine',     notes: [659.25, 987.77],                gap: 0.22, len: 0.8,  gain: 0.13 },
  };

  function playTheme(name, quiet) {
    const th = SOUND_THEMES[name];
    if (!th) return Promise.resolve(); // 'none' או לא מוכר
    return new Promise(resolve => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = th.gain * (quiet ? 0.6 : 1);
        th.notes.forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = f;
          o.type = th.wave;
          const t0 = ctx.currentTime + i * th.gap;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(gain, t0 + 0.04);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + th.len);
          o.connect(g).connect(ctx.destination);
          o.start(t0);
          o.stop(t0 + th.len + 0.1);
        });
        const total = (th.notes.length - 1) * th.gap + th.len;
        setTimeout(() => { ctx.close(); resolve(); }, total * 1000 + 250);
      } catch (e) { resolve(); }
    });
  }

  function chime() {
    return playTheme(Store.data.settings.announceSound);
  }

  // צליל מעבר עדין בין סרטונים
  function softChime() {
    playTheme(Store.data.settings.transitionSoundName, true);
  }

  // המתנה לטעינת רשימת הקולות (בחלק מהדפדפנים היא נטענת באיחור)
  function getVoicesAsync() {
    return new Promise(resolve => {
      let vs = speechSynthesis.getVoices();
      if (vs.length) return resolve(vs);
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }

  function pickHebrewVoice(voices) {
    return voices.find(v => /^he[-_]/i.test(v.lang) || v.lang === 'he')
      || voices.find(v => /hebrew|עברית|ivrit/i.test(v.name || ''))
      || null;
  }

  function speakTime() {
    return new Promise(async (resolve) => {
      await chime();
      if (!('speechSynthesis' in window)) return resolve();
      const voices = await getVoicesAsync();
      const heVoice = pickHebrewVoice(voices);
      // אין קול עברי במכשיר — עדיף רק צליל מאשר הקראה מעוותת בקול לועזי
      if (!heVoice) return resolve();
      const utter = new SpeechSynthesisUtterance(timePhrase());
      utter.voice = heVoice;
      utter.lang = heVoice.lang || 'he-IL';
      utter.rate = 1;
      utter.pitch = 1;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      utter.onend = finish;
      utter.onerror = finish;
      setTimeout(finish, 12000); // חגורת ביטחון
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    });
  }

  // ---- בחירת סרטונים ----
  async function buildPool(role) {
    const channels = Store.channelsFor(role);
    const pools = await Promise.all(channels.map(async (ch) => {
      try {
        const feed = await YTBridge.fetchFeed(ch.kind, ch.ytId);
        return feed.videos.map(v => Object.assign({}, v, { channelTitle: v.channelTitle || feed.title || ch.title }));
      } catch (e) {
        console.warn('feed failed for', ch.title, e);
        return [];
      }
    }));
    let all = pools.flat().filter(v => !Engine.blocked[v.videoId]);
    if (Store.data.settings.skipShorts && all.length) {
      await YTBridge.classifyShorts(all.map(v => v.videoId));
      const filtered = all.filter(v => !YTBridge.isShort(v.videoId));
      if (filtered.length) all = filtered; // אם הכול שורטס — עדיף שורט משתיקה
    }
    return all;
  }

  function pickRandom(pool, avoidChannel) {
    if (!pool.length) return null;
    let list = pool.filter(v => !Engine.recent.includes(v.videoId));
    if (!list.length) list = pool;
    // גיוון: לא לחזור על אותו ערוץ ברצף, אם יש חלופות
    if (avoidChannel) {
      const diverse = list.filter(v => v.channelTitle !== avoidChannel);
      if (diverse.length) list = diverse;
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function playVideo(v, startSeconds) {
    rememberRecent(v.videoId);
    setTrack(v);
    softChime(); // מנגן רק אם נבחר צליל
    YTBridge.play(v.videoId, startSeconds);
    YTBridge.unMute();
    if (Store.data.settings.videoMode !== 'normal') YTBridge.lowQuality();
  }

  function saveTalkPosition() {
    if (Engine.currentTalk) {
      const t = YTBridge.currentTime();
      if (t > 5) Engine.positions[Engine.currentTalk.videoId] = Math.max(0, t - 3);
      savePositions();
    }
  }

  // ---- מקטעים ----
  async function startTalk(forceNew) {
    const talkPool = await buildPool('talk');
    let v = null;
    let pos = 0;
    if (!forceNew && Engine.currentTalk) {
      v = Engine.currentTalk;
      pos = Engine.positions[v.videoId] || 0;
    } else {
      v = pickRandom(talkPool, Engine.lastTalkChannel);
      if (v) pos = Engine.positions[v.videoId] || 0;
    }
    if (!v) {
      // אין ערוצי דיבורים — רדיו מוזיקה רצוף
      return startSong(true);
    }
    Engine.currentTalk = v;
    Engine.lastTalkChannel = v.channelTitle;
    setPhase('talk');
    Engine.talkDeadline = Date.now() + Store.data.settings.talkMinutes * 60 * 1000;
    status('');
    playVideo(v, pos);
  }

  async function startSong(continuous) {
    saveTalkPosition();
    const pool = await buildPool('music');
    const v = pickRandom(pool, Engine.lastSongChannel);
    if (!v) {
      // אין מוזיקה — נשארים בדיבורים
      if (Engine.phase !== 'talk') return startTalk(false);
      Engine.talkDeadline = Date.now() + Store.data.settings.talkMinutes * 60 * 1000;
      return;
    }
    Engine.lastSongChannel = v.channelTitle;
    setPhase('song');
    Engine.continuousMusic = !!continuous;
    status('');
    playVideo(v, 0);
  }

  async function startNews() {
    const pool = Store.channelsFor('news');
    if (!pool.length) return startTalk(false);
    saveTalkPosition();
    try {
      const ch = pool[0];
      const feed = await YTBridge.fetchFeed(ch.kind, ch.ytId, true); // תמיד טרי
      const latest = feed.videos[0];
      if (!latest) return startTalk(false);
      setPhase('news');
      Engine.newsDeadline = Date.now() + Store.data.settings.newsMinutes * 60 * 1000;
      status('מהדורת חדשות 📰');
      playVideo(Object.assign({}, latest, { channelTitle: latest.channelTitle || feed.title }), 0);
    } catch (e) {
      console.warn('news failed', e);
      startTalk(false);
    }
  }

  async function hourlyBreak() {
    Engine.lastBreakHour = ilTime().h;
    saveTalkPosition();
    const s = Store.data.settings;
    if (s.announceHour) {
      setPhase('announce');
      status('הכרזת שעה 🕰️');
      YTBridge.pause();
      await speakTime();
    }
    if (!Engine.on) return;
    if (s.newsEnabled && Store.channelsFor('news').length) {
      await startNews();
    } else {
      await startTalk(false);
    }
  }

  // ---- טיק ----
  function tick() {
    if (!Engine.on) return;
    const now = ilTime();

    // שעה עגולה חדשה? (לפי שעון ישראל)
    if (now.m === 0 && now.h !== Engine.lastBreakHour
      && (Engine.phase === 'talk' || Engine.phase === 'song')) {
      hourlyBreak();
      return;
    }

    // נגמר זמן הדיבורים → שיר
    if (Engine.phase === 'talk' && Date.now() > Engine.talkDeadline) {
      startSong(false);
      return;
    }

    // חדשות ארוכות מדי → חוזרים לדיבורים
    if (Engine.phase === 'news' && Date.now() > Engine.newsDeadline) {
      startTalk(false);
      return;
    }

    // שמירת מיקום שוטפת בדיבורים
    if (Engine.phase === 'talk' && Math.floor(Date.now() / 1000) % 15 === 0) {
      saveTalkPosition();
    }
  }

  function onPlayerState(e) {
    if (!Engine.on) return;
    if (e.data === 'error') {
      // שגיאה 150/101 = בעל הערוץ חוסם ניגון מחוץ ליוטיוב. חוסמים את הסרטון לתמיד וממשיכים.
      if (Engine.current) blockVideo(Engine.current.videoId);
      Engine.errorStreak++;
      if (Engine.errorStreak >= 8) {
        status('לא הצלחתי לנגן — נראה שהערוצים האלה חוסמים ניגון מחוץ ליוטיוב 😢 נסי ערוצים אחרים');
        powerOff(true);
        return;
      }
      status('הסרטון חסום לניגון מחוץ ליוטיוב, מדלגת… ⏭');
      setTimeout(() => skip(), 1500);
      return;
    }
    if (e.data === YT.PlayerState.PLAYING) {
      Engine.errorStreak = 0;
      status('');
    }
    if (e.data === YT.PlayerState.ENDED) {
      if (Engine.phase === 'song') {
        if (Engine.continuousMusic) startSong(true);
        else startTalk(false);
      } else if (Engine.phase === 'talk') {
        // הסרטון נגמר לפני הזמן — ממשיכים לסרטון דיבורים אחר
        if (Engine.currentTalk) delete Engine.positions[Engine.currentTalk.videoId];
        Engine.currentTalk = null;
        savePositions();
        startTalk(true);
      } else if (Engine.phase === 'news') {
        startTalk(false);
      }
    }
  }

  // ---- פעולות ----
  async function powerOn() {
    if (Engine.on) return;
    if (!Store.data.channels.length) {
      status('צריך להוסיף ערוצים קודם 🙈');
      return;
    }
    Engine.on = true;
    Engine.lastBreakHour = ilTime().h;
    await YTBridge.loadPlayer();
    YTBridge.onState(onPlayerState);
    Engine.tickTimer = setInterval(tick, 1000);

    // חימום קול (iOS דורש דיבור ראשון מתוך מחוות משתמש)
    if ('speechSynthesis' in window) speechSynthesis.getVoices();

    status('הרדיו מתעורר… ✨');
    if (Store.data.settings.announceHour) {
      setPhase('announce');
      await speakTime();
      if (!Engine.on) return;
    }
    const m = ilTime().m;
    if (Store.data.settings.newsEnabled && m < 7 && Store.channelsFor('news').length) {
      Engine.lastBreakHour = ilTime().h;
      await startNews();
    } else {
      await startTalk(false);
    }
  }

  function powerOff(keepStatus) {
    Engine.on = false;
    saveTalkPosition();
    clearInterval(Engine.tickTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    YTBridge.stop();
    setPhase('off');
    setTrack(null);
    if (!keepStatus) status('');
  }

  function skip() {
    if (!Engine.on) return;
    if (Engine.phase === 'talk') {
      if (Engine.currentTalk) delete Engine.positions[Engine.currentTalk.videoId];
      Engine.currentTalk = null;
      startTalk(true);
    } else if (Engine.phase === 'song') {
      startSong(Engine.continuousMusic);
    } else if (Engine.phase === 'news') {
      startTalk(false);
    }
  }

  function onMoodChanged() {
    if (!Engine.on) return;
    // מחליפים מיד לתוכן שמתאים למצב הרוח החדש
    if (Engine.phase === 'talk') { Engine.currentTalk = null; startTalk(true); }
    else if (Engine.phase === 'song') startSong(Engine.continuousMusic);
  }

  window.Engine = Engine;
  Engine.powerOn = powerOn;
  Engine.powerOff = powerOff;
  Engine.skip = skip;
  Engine.songNow = () => { if (Engine.on) startSong(false); };
  Engine.talkNow = () => { if (Engine.on) { saveTalkPosition(); startTalk(false); } };
  Engine.newsNow = () => { if (Engine.on) startNews(); };
  Engine.onMoodChanged = onMoodChanged;
  Engine.previewSound = (name) => playTheme(name);
})();

// ===== רדיולי — מנוע הרדיו: כרוזת שעה, חדשות, דיבורים, שירים =====
(function () {
  const POS_KEY = 'radioli-positions-v1';

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

  // ---- כרוזת שעה ----
  const HOUR_WORDS = ['שתים עשרה', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר', 'אחת עשרה'];

  function timePhrase() {
    const t = ilTime();
    const h = HOUR_WORDS[t.h % 12];
    const m = t.m;
    let suffix = '';
    if (m === 0) suffix = ' בדיוק';
    else if (m === 30) suffix = ' וחצי';
    else suffix = ' ו־' + m + ' דקות';
    const part = t.h < 5 ? 'בלילה' : t.h < 12 ? 'בבוקר' : t.h < 17 ? 'אחר הצהריים' : t.h < 21 ? 'בערב' : 'בלילה';
    return 'כאן רדיולי. השעה ' + h + suffix + ' ' + part + '.';
  }

  function chime() {
    return new Promise(resolve => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = f;
          o.type = 'sine';
          g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
          g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.35 + 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.6);
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + i * 0.35);
          o.stop(ctx.currentTime + i * 0.35 + 0.7);
        });
        setTimeout(() => { ctx.close(); resolve(); }, 1600);
      } catch (e) { resolve(); }
    });
  }

  // צליל מעבר עדין בין סרטונים (שני תווים רכים)
  function softChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [659.25, 987.77].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.22 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.8);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.22);
        o.stop(ctx.currentTime + i * 0.22 + 0.9);
      });
      setTimeout(() => ctx.close(), 1400);
    } catch (e) {}
  }

  function speakTime() {
    return new Promise(async (resolve) => {
      await chime();
      if (!('speechSynthesis' in window)) return resolve();
      const text = timePhrase();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const heVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('he'))
        || voices.find(v => /hebrew|ivrit/i.test(v.name || ''));
      if (heVoice) utter.voice = heVoice;
      utter.lang = 'he-IL';
      utter.rate = 0.95;
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
    let all = pools.flat();
    if (Store.data.settings.skipShorts && all.length) {
      await YTBridge.classifyShorts(all.map(v => v.videoId));
      const filtered = all.filter(v => !YTBridge.isShort(v.videoId));
      if (filtered.length) all = filtered; // אם הכול שורטס — עדיף שורט משתיקה
    }
    return all;
  }

  function pickRandom(pool) {
    if (!pool.length) return null;
    const fresh = pool.filter(v => !Engine.recent.includes(v.videoId));
    const list = fresh.length ? fresh : pool;
    return list[Math.floor(Math.random() * list.length)];
  }

  function playVideo(v, startSeconds) {
    rememberRecent(v.videoId);
    setTrack(v);
    if (Store.data.settings.transitionSound) softChime();
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
      v = pickRandom(talkPool);
      if (v) pos = Engine.positions[v.videoId] || 0;
    }
    if (!v) {
      // אין ערוצי דיבורים — רדיו מוזיקה רצוף
      return startSong(true);
    }
    Engine.currentTalk = v;
    setPhase('talk');
    Engine.talkDeadline = Date.now() + Store.data.settings.talkMinutes * 60 * 1000;
    status('');
    playVideo(v, pos);
  }

  async function startSong(continuous) {
    saveTalkPosition();
    const pool = await buildPool('music');
    const v = pickRandom(pool);
    if (!v) {
      // אין מוזיקה — נשארים בדיבורים
      if (Engine.phase !== 'talk') return startTalk(false);
      Engine.talkDeadline = Date.now() + Store.data.settings.talkMinutes * 60 * 1000;
      return;
    }
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
      status('כרוזת שעה 🕰️');
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
      status('סרטון לא זמין, ממשיכים הלאה…');
      setTimeout(() => skip(), 1200);
      return;
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

  function powerOff() {
    Engine.on = false;
    saveTalkPosition();
    clearInterval(Engine.tickTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    YTBridge.stop();
    setPhase('off');
    setTrack(null);
    status('');
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
})();

// ===== רדיולי — מנוע הרדיו: כרוזת שעה, חדשות, דיבורים, שירים =====
(function () {
  const POS_KEY = 'radioli-positions-v1';
  const BLOCKED_KEY = 'radioli-blocked-v1';
  const HEARD_KEY = 'radioli-heard-v1';

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
    heard: loadHeard(),
    errorStreak: 0,
    switching: false,     // מגן מפני מעברים כפולים במקביל
    songDeadline: 0,
    lastAliveAt: 0,       // כלב שמירה: מתי לאחרונה הנגן באמת ניגן
    paused: false,        // השהיה יזומה של המשתמש
    pausedAt: 0,
    programDeadline: 0,
    lastProgramFire: {},  // {id@יום: true} — תוכניות שכבר הופעלו היום (למנוע כפילות)
    tickTimer: null,
    ui: { onPhase() {}, onTrack() {}, onStatus() {}, onPaused() {} },
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

  // סרטונים שכבר נשמעו — לא חוזרים עליהם (עד שנגמר המאגר)
  function loadHeard() {
    try { return JSON.parse(localStorage.getItem(HEARD_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function markHeard(videoId) {
    if (!videoId || Engine.heard[videoId]) return;
    Engine.heard[videoId] = Date.now();
    const keys = Object.keys(Engine.heard);
    if (keys.length > 3000) {
      keys.sort((a, b) => Engine.heard[a] - Engine.heard[b]);
      keys.slice(0, 500).forEach(k => delete Engine.heard[k]);
    }
    localStorage.setItem(HEARD_KEY, JSON.stringify(Engine.heard));
  }

  function status(msg) { Engine.ui.onStatus(msg || ''); }

  // לוח השידורים בפועל: נוסחת מצב הרוח הפעיל, ואם אין — ההגדרות הכלליות
  function sched() {
    const s = Store.data.settings;
    const mood = Store.data.moods.find(m => m.id === Store.data.activeMood);
    const r = (mood && mood.recipe) || {};
    return {
      talkMin: r.talkMin != null ? r.talkMin : s.talkMinutes,   // 0 = בלי דיבורים (רק מוזיקה)
      songs: r.songs != null ? r.songs : 1,                     // 0 = בלי שירים (רק דיבורים)
      news: r.news != null ? r.news : s.newsEnabled,
      announce: r.announce != null ? r.announce : s.announceHour,
    };
  }

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
    // "רדיו לי" בשתי מילים — כדי שהקריין יהגה בחולם (רדיו-לי) ולא בשורוק
    return 'כאן רדיו לי. השעה ' + h + suffix + ' ' + part + '.';
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

  // קריינות איכותית דרך השרת (Google TTS) — מנוגנת ב-WebAudio כדי לעקוף חסימות ניגון אוטומטי
  async function speakViaProxy(text) {
    const res = await fetch(window.RADIOLI_PROXY + '?tts=' + encodeURIComponent(text));
    if (!res.ok) throw new Error('tts ' + res.status);
    const data = await res.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    const buf = await ctx.decodeAudioData(data);
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; try { ctx.close(); } catch (e) {} resolve(); } };
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = finish;
      src.start();
      setTimeout(finish, buf.duration * 1000 + 2000);
    });
  }

  // נפילה: קול עברי של המכשיר
  function speakViaDevice(text) {
    return new Promise(async (resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const voices = await getVoicesAsync();
      const heVoice = pickHebrewVoice(voices);
      // אין קול עברי במכשיר — עדיף רק צליל מאשר הקראה מעוותת בקול לועזי
      if (!heVoice) return resolve();
      const utter = new SpeechSynthesisUtterance(text);
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

  async function speakTime() {
    await chime();
    const text = timePhrase();
    try {
      await speakViaProxy(text);
    } catch (e) {
      console.warn('proxy tts failed, falling back to device voice', e);
      await speakViaDevice(text);
    }
  }

  // ---- בחירת סרטונים ----
  async function buildPool(role) {
    const channels = Store.channelsFor(role);
    const pools = await Promise.all(channels.map(async (ch) => {
      try {
        const feed = await YTBridge.fetchFeed(ch.kind, ch.ytId);
        return feed.videos.map(v => Object.assign({}, v, {
          channelTitle: v.channelTitle || feed.title || ch.title,
          needShortCheck: !feed.shortsFree,
        }));
      } catch (e) {
        console.warn('feed failed for', ch.title, e);
        return [];
      }
    }));
    let all = pools.flat().filter(v => !Engine.blocked[v.videoId]);
    if (Store.data.settings.skipShorts && all.length) {
      // פידים של ערוצים כבר נקיים משורטס (UULF); בודקים רק פלייליסטים ידניים
      const toCheck = all.filter(v => v.needShortCheck);
      if (toCheck.length) await YTBridge.classifyShorts(toCheck.map(v => v.videoId));
      const filtered = all.filter(v => !v.needShortCheck || !YTBridge.isShort(v.videoId));
      if (filtered.length) all = filtered; // אם הכול שורטס — עדיף שורט משתיקה
    }
    // מסננים סרטונים שכבר נשמעו; אם הכול נשמע — מוותרים על הסינון (שיהיה מה לנגן)
    const unheard = all.filter(v => !Engine.heard[v.videoId]);
    if (unheard.length) all = unheard;
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
    Engine.lastAliveAt = Date.now(); // כלב השמירה מתחיל לספור מחדש
    Engine.nudged = false;
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
      // האזנה משמעותית — לא להציע את הסרטון שוב בהפעלות הבאות
      if (t > 90) markHeard(Engine.currentTalk.videoId);
      savePositions();
    }
  }

  // ---- מקטעים ----
  async function startTalk(forceNew) {
    if (sched().talkMin === 0) return startSong(true); // נוסחת "רק שירים"
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
      const hasTalkChannels = Store.channelsFor('talk').length > 0;
      if (hasTalkChannels) {
        // יש ערוצי דיבורים אבל לא הצלחנו להביא מהם כלום (תקלה זמנית / הכול חסום)
        // מנגנים שיר אחד ובסופו ננסה דיבורים שוב — לא נופלים למוזיקה לתמיד
        status('לא הצלחתי להביא דיבורים כרגע — שיר וננסה שוב 🎙️');
        return startSong(false);
      }
      return startSong(true); // אין בכלל ערוצי דיבורים — רדיו מוזיקה רצוף
    }
    if (!pos) pos = Store.data.settings.introSkipSeconds || 0; // דילוג על פתיח
    Engine.currentTalk = v;
    Engine.lastTalkChannel = v.channelTitle;
    setPhase('talk');
    Engine.talkDeadline = Date.now() + sched().talkMin * 60 * 1000;
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
    Engine.songDeadline = Date.now() + Store.data.settings.songMinutes * 60 * 1000;
    status('');
    playVideo(v, 0);
  }

  async function startNews() {
    const pool = Store.channelsFor('news');
    if (!pool.length) {
      status('לא הוגדר ערוץ חדשות — ממשיכים 📰');
      return startTalk(false);
    }
    saveTalkPosition();
    try {
      const ch = pool[0];
      const feed = await YTBridge.fetchFeed(ch.kind, ch.ytId, true); // תמיד טרי
      const latest = feed.videos.find(v => !Engine.blocked[v.videoId]) || feed.videos[0];
      if (!latest) {
        status('לא נמצאו חדשות בערוץ 😢');
        return startTalk(false);
      }
      setPhase('news');
      Engine.newsDeadline = Date.now() + Store.data.settings.newsMinutes * 60 * 1000;
      status('מהדורת חדשות 📰');
      playVideo(Object.assign({}, latest, { channelTitle: latest.channelTitle || feed.title }), 0);
    } catch (e) {
      console.warn('news failed', e);
      status('לא הצלחתי להביא חדשות כרגע 😢');
      startTalk(false);
    }
  }

  async function startLiveProgram(prog) {
    saveTalkPosition();
    setPhase('live');
    status('🔴 שידור חי: ' + (prog.title || ''));
    Engine.programDeadline = prog.durationMin ? Date.now() + prog.durationMin * 60 * 1000 : Infinity;
    try {
      const live = await YTBridge.fetchLive(prog.ytId);
      const label = prog.title || live.title || 'שידור חי';
      playVideo({ videoId: live.videoId, title: label, channelTitle: live.live ? '🔴 חי עכשיו' : 'לא בשידור כרגע' }, 0);
    } catch (e) {
      console.warn('live program failed', e);
      status('לא הצלחתי לפתוח את השידור החי 😢 ממשיכים');
      Engine.programDeadline = Infinity;
      startTalk(false);
    }
  }

  async function hourlyBreak() {
    Engine.lastBreakHour = ilTime().h;
    saveTalkPosition();
    const sc = sched();
    if (sc.announce) {
      setPhase('announce');
      status('הכרזת שעה 🕰️');
      YTBridge.pause();
      await speakTime();
    }
    if (!Engine.on) return;
    if (sc.news && Store.channelsFor('news').length) {
      await startNews();
    } else {
      await startTalk(false);
    }
  }

  // ---- טיק ----
  // עוטף מעבר אסינכרוני כך שלא יופעל פעמיים במקביל (זה גרם לקפיצות בין שירים)
  async function transition(fn) {
    if (Engine.switching) return;
    Engine.switching = true;
    try { await fn(); } finally { Engine.switching = false; }
  }

  // תוכנית קבועה שהגיע זמנה? חלון של עד 10 דקות איחור —
  // כדי לתפוס תוכניות גם אם הדפדפן האט/השהה את הטיימר (למשל מסך נעול) בדיוק בדקה המדויקת.
  const PROGRAM_GRACE_MIN = 10;
  function dueProgram(now, dayKey) {
    const progs = Store.data.programs || [];
    const nowMin = now.h * 60 + now.m;
    for (const p of progs) {
      if (p.days && p.days.length && !p.days.includes(new Date().getDay())) continue;
      let diff = nowMin - (p.hour * 60 + p.minute);
      if (diff < 0) diff += 24 * 60; // מעבר חצות
      if (diff > PROGRAM_GRACE_MIN) continue;
      const fireKey = p.id + '@' + dayKey;
      if (Engine.lastProgramFire[fireKey]) continue;
      Engine.lastProgramFire[fireKey] = true;
      return p;
    }
    return null;
  }

  function tick() {
    if (!Engine.on || Engine.switching) return;
    const now = ilTime();
    const dayKey = new Date().toDateString();

    // תוכנית קבועה (שידור חי) — גוברת על הכול, גם אם הרדיו בהשהיה
    const prog = dueProgram(now, dayKey);
    if (prog) {
      if (Engine.paused) { Engine.paused = false; Engine.ui.onPaused(false); }
      transition(() => startLiveProgram(prog));
      return;
    }

    if (Engine.paused) return; // שאר הלוח קפוא בהשהיה

    // שידור חי חורג מהזמן שהוקצב → חוזרים ללוח הרגיל
    if (Engine.phase === 'live' && Engine.programDeadline !== Infinity && Date.now() > Engine.programDeadline) {
      Engine.programDeadline = Infinity;
      transition(() => startTalk(false));
      return;
    }

    // בשידור חי לא מפעילים את שאר לוח השידורים
    if (Engine.phase === 'live') { Engine.lastAliveAt = Date.now(); return; }

    // שעה עגולה חדשה? (לפי שעון ישראל)
    if (now.m === 0 && now.h !== Engine.lastBreakHour
      && (Engine.phase === 'talk' || Engine.phase === 'song')) {
      transition(hourlyBreak);
      return;
    }

    // נגמר זמן הדיבורים → שיר (או המשך דיבורים, לפי הנוסחה)
    if (Engine.phase === 'talk' && Date.now() > Engine.talkDeadline) {
      const sc = sched();
      if (sc.songs === 0) { // נוסחת "רק דיבורים"
        Engine.talkDeadline = Date.now() + sc.talkMin * 60 * 1000;
        return;
      }
      Engine.talkDeadline = Infinity;
      Engine.songsLeft = sc.songs;
      transition(() => startSong(false));
      return;
    }

    // נגמר זמן המוזיקה → חוזרים לדיבורים (אלא אם השיר ממש עומד להסתיים)
    if (Engine.phase === 'song' && Date.now() > Engine.songDeadline) {
      let remaining = Infinity;
      try {
        const d = YTBridge.player.getDuration();
        if (d > 0) remaining = d - YTBridge.currentTime();
      } catch (e) {}
      if (remaining < 90) {
        Engine.songDeadline = Date.now() + remaining * 1000 + 5000; // נותנים לו לסיים יפה
      } else {
        Engine.songDeadline = Infinity;
        Engine.songsLeft = (Engine.songsLeft || 1) - 1;
        transition(() => Engine.continuousMusic ? startSong(true)
          : (Engine.songsLeft > 0 ? startSong(false) : startTalk(false)));
        return;
      }
    }

    // חדשות ארוכות מדי → חוזרים לדיבורים
    if (Engine.phase === 'news' && Date.now() > Engine.newsDeadline) {
      Engine.newsDeadline = Infinity;
      transition(() => startTalk(false));
      return;
    }

    // כלב שמירה: אם הנגן לא מתנגן ולא מושהה יותר מ-30 שניות — ממשיכים הלאה
    if (Engine.phase === 'talk' || Engine.phase === 'song' || Engine.phase === 'news') {
      try {
        const st = YTBridge.player.getPlayerState();
        if (st === YT.PlayerState.PLAYING || st === YT.PlayerState.PAUSED) {
          Engine.lastAliveAt = Date.now();
        } else if (Date.now() - Engine.lastAliveAt > 30000) {
          Engine.lastAliveAt = Date.now();
          if (!Engine.nudged) {
            // ניסיון עדין קודם: אולי הדפדפן רק חסם ניגון אוטומטי
            Engine.nudged = true;
            YTBridge.resume();
          } else {
            status('ההשמעה נתקעה, ממשיכים הלאה… ⏭');
            transition(() => { skip(); });
          }
          return;
        }
      } catch (e) {}
    }

    // שמירת מיקום שוטפת בדיבורים
    if (Engine.phase === 'talk' && Math.floor(Date.now() / 1000) % 15 === 0) {
      saveTalkPosition();
    }
  }

  function onPlayerState(e) {
    if (!Engine.on) return;
    if (e.data === 'error') {
      // 100/101/150 = הסרטון חסום/נמחק — חוסמים לתמיד. שגיאות אחרות (רשת וכו') הן זמניות — רק מדלגים.
      const fatal = e.code === 100 || e.code === 101 || e.code === 150;
      if (fatal && Engine.current) blockVideo(Engine.current.videoId);
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
      // שידור חי שהסתיים → חוזרים ללוח הרגיל
      if (Engine.phase === 'live') {
        Engine.programDeadline = Infinity;
        return transition(() => startTalk(false));
      }
      // דיבורים שנשמעו עד הסוף לא חוזרים; שירים כן מותר לנגן שוב (רק דילוג חוסם אותם)
      if (Engine.phase !== 'song' && Engine.current) markHeard(Engine.current.videoId);
      if (Engine.phase === 'song') {
        Engine.songsLeft = (Engine.songsLeft || 1) - 1;
        transition(() => Engine.continuousMusic ? startSong(true)
          : (Engine.songsLeft > 0 ? startSong(false) : startTalk(false)));
      } else if (Engine.phase === 'talk') {
        // הסרטון נגמר לפני הזמן — ממשיכים לסרטון דיבורים אחר
        if (Engine.currentTalk) delete Engine.positions[Engine.currentTalk.videoId];
        Engine.currentTalk = null;
        savePositions();
        transition(() => startTalk(true));
      } else if (Engine.phase === 'news') {
        transition(() => startTalk(false));
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
    const sc = sched();
    if (sc.announce) {
      setPhase('announce');
      await speakTime();
      if (!Engine.on) return;
    }
    const m = ilTime().m;
    if (sc.news && m < 7 && Store.channelsFor('news').length) {
      Engine.lastBreakHour = ilTime().h;
      await startNews();
    } else {
      await startTalk(false);
    }
  }

  function powerOff(keepStatus) {
    Engine.on = false;
    Engine.paused = false;
    Engine.ui.onPaused(false);
    saveTalkPosition();
    Engine.currentTalk = null; // בהפעלה הבאה — תוכן חדש, לא אותו שיעור שוב
    clearInterval(Engine.tickTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    YTBridge.stop();
    setPhase('off');
    setTrack(null);
    if (!keepStatus) status('');
  }

  // השהיה / המשך יזומים. בהשהיה מקפיאים את מועדי המעבר כדי שלא "יקפוץ" בחזרה.
  function togglePause() {
    if (!Engine.on) return Engine.paused;
    if (Engine.paused) {
      const delta = Date.now() - Engine.pausedAt;
      ['talkDeadline', 'songDeadline', 'newsDeadline', 'programDeadline'].forEach(k => {
        if (isFinite(Engine[k])) Engine[k] += delta;
      });
      Engine.paused = false;
      Engine.lastAliveAt = Date.now();
      Engine.nudged = false;
      YTBridge.resume();
    } else {
      Engine.paused = true;
      Engine.pausedAt = Date.now();
      YTBridge.pause();
    }
    Engine.ui.onPaused(Engine.paused);
    return Engine.paused;
  }

  // דילוג רגיל — רק להפעם. המיקום נשמר, והסרטון עדיין יכול לחזור בעתיד.
  function skip() {
    if (!Engine.on) return;
    if (Engine.phase === 'live') { Engine.programDeadline = Infinity; return startTalk(false); }
    if (Engine.phase === 'talk') {
      saveTalkPosition();
      Engine.currentTalk = null;
      return startTalk(true);
    } else if (Engine.phase === 'song') {
      return startSong(Engine.continuousMusic);
    } else if (Engine.phase === 'news') {
      return startTalk(false);
    }
  }

  // "לא שוב" — הקטע הנוכחי לא יושמע יותר לעולם
  function banCurrent() {
    if (!Engine.on || !Engine.current) return;
    markHeard(Engine.current.videoId);
    delete Engine.positions[Engine.current.videoId];
    savePositions();
    status('לא נשמיע את זה שוב 🚫');
    if (Engine.phase === 'talk') {
      Engine.currentTalk = null;
      return startTalk(true);
    } else if (Engine.phase === 'song') {
      return startSong(Engine.continuousMusic);
    } else if (Engine.phase === 'news') {
      return startTalk(false);
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
  Engine.togglePause = togglePause;
  Engine.playProgram = (prog) => { if (Engine.on) transition(() => startLiveProgram(prog)); };
  Engine.skip = skip;
  Engine.banNow = banCurrent;
  Engine.resetBlocked = () => {
    Engine.blocked = {};
    localStorage.removeItem(BLOCKED_KEY);
    Engine.errorStreak = 0;
  };
  Engine.resetHeard = () => {
    Engine.heard = {};
    localStorage.removeItem(HEARD_KEY);
  };
  Engine.songNow = () => { if (Engine.on) { Engine.songsLeft = 1; startSong(false); } };
  Engine.talkNow = () => { if (Engine.on) { saveTalkPosition(); startTalk(false); } };
  Engine.newsNow = () => { if (Engine.on) startNews(); };
  Engine.onMoodChanged = onMoodChanged;
  Engine.previewSound = (name) => playTheme(name);
  Engine.sched = sched;
})();

// ===== רדיולי — יוטיוב: פרוקסי RSS, זיהוי קלט, ונגן =====
(function () {
  const feedCache = new Map(); // ytId -> {at, title, videos}
  const FEED_TTL = 30 * 60 * 1000;

  async function proxyGet(params) {
    const url = window.RADIOLI_PROXY + '?' + new URLSearchParams(params).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error('proxy ' + res.status);
    return res;
  }

  // מפענח קלט חופשי: קישור ערוץ / פלייליסט / @כינוי / מזהה
  function parseInput(text) {
    text = text.trim();
    let m;
    if ((m = text.match(/[?&]list=([\w-]{10,60})/))) return { kind: 'playlist', ytId: m[1] };
    if ((m = text.match(/youtube\.com\/playlist\?.*list=([\w-]{10,60})/))) return { kind: 'playlist', ytId: m[1] };
    if ((m = text.match(/\/channel\/(UC[\w-]{22})/))) return { kind: 'channel', ytId: m[1] };
    if ((m = text.match(/^(UC[\w-]{22})$/))) return { kind: 'channel', ytId: m[1] };
    if ((m = text.match(/\/@([\w.\-%]+)/))) return { kind: 'handle', handle: decodeURIComponent(m[1]) };
    if ((m = text.match(/^@([\w.\-]+)$/))) return { kind: 'handle', handle: m[1] };
    if ((m = text.match(/\/user\/([\w.\-]+)/))) return { kind: 'handle', handle: m[1], legacy: 'user' };
    if ((m = text.match(/\/c\/([\w.\-%]+)/))) return { kind: 'handle', handle: decodeURIComponent(m[1]), legacy: 'c' };
    if ((m = text.match(/^(PL[\w-]{10,60}|UU[\w-]{22}|OL[\w-]{10,60})$/))) return { kind: 'playlist', ytId: m[1] };
    // ניסיון אחרון: מתייחסים לטקסט כאל כינוי
    if (/^[\w.\-]{2,50}$/.test(text)) return { kind: 'handle', handle: text };
    return null;
  }

  // הופך כינוי (@handle) למזהה ערוץ UC דרך הפרוקסי
  async function resolveHandle(parsed) {
    const q = (parsed.legacy ? parsed.legacy + ':' : '') + parsed.handle;
    const res = await proxyGet({ resolve: q });
    const json = await res.json();
    if (!json.channelId) throw new Error(json.error || 'לא נמצא ערוץ');
    return { kind: 'channel', ytId: json.channelId, title: json.title || '' };
  }

  function parseFeedXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('feed parse error');
    const feedTitleEl = doc.getElementsByTagName('title')[0];
    const title = feedTitleEl ? feedTitleEl.textContent : '';
    const entries = Array.from(doc.getElementsByTagName('entry'));
    const videos = entries.map(en => {
      const idEl = en.getElementsByTagName('yt:videoId')[0];
      const tEl = en.getElementsByTagName('title')[0];
      const aEl = en.getElementsByTagName('name')[0];
      const pEl = en.getElementsByTagName('published')[0];
      return idEl ? {
        videoId: idEl.textContent,
        title: tEl ? tEl.textContent : '',
        channelTitle: aEl ? aEl.textContent : '',
        published: pEl ? pEl.textContent : '',
      } : null;
    }).filter(Boolean);
    return { title, videos };
  }

  // מביא את הסרטונים האחרונים של ערוץ/פלייליסט (עם מטמון)
  async function fetchFeed(kind, ytId, force) {
    const cacheKey = kind + ':' + ytId;
    const cached = feedCache.get(cacheKey);
    if (!force && cached && Date.now() - cached.at < FEED_TTL) return cached;
    const res = await proxyGet({ feed: kind, id: ytId });
    const parsed = parseFeedXml(await res.text());
    const out = { at: Date.now(), title: parsed.title, videos: parsed.videos };
    feedCache.set(cacheKey, out);
    return out;
  }

  // ---- זיהוי שורטס ----
  // סרטון הוא "שורט" אם youtube.com/shorts/{id} מחזיר 200 (אחרת יש הפניה ל-watch).
  // הבדיקה נעשית פעם אחת לכל סרטון דרך הפרוקסי ונשמרת לתמיד.
  const SHORTS_KEY = 'radioli-shorts-v1';
  let shortsCache = {};
  try { shortsCache = JSON.parse(localStorage.getItem(SHORTS_KEY)) || {}; } catch (e) {}

  async function classifyShorts(videoIds) {
    const unknown = videoIds.filter(id => !(id in shortsCache)).slice(0, 30);
    if (unknown.length) {
      try {
        const res = await proxyGet({ shorts: unknown.join(',') });
        const json = await res.json();
        let changed = false;
        Object.entries(json).forEach(([id, val]) => {
          if (val === true || val === false) { shortsCache[id] = val; changed = true; }
        });
        if (changed) localStorage.setItem(SHORTS_KEY, JSON.stringify(shortsCache));
      } catch (e) { console.warn('shorts check failed', e); }
    }
  }

  function isShort(videoId) { return shortsCache[videoId] === true; }

  // ---- נגן יוטיוב ----
  let player = null;
  let playerReadyResolve;
  const playerReady = new Promise(r => { playerReadyResolve = r; });
  let stateHandler = () => {};

  function loadPlayer() {
    if (window.YT && window.YT.Player) { createPlayer(); return playerReady; }
    window.onYouTubeIframeAPIReady = createPlayer;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    return playerReady;
  }

  function createPlayer() {
    player = new YT.Player('ytPlayer', {
      width: '100%',
      height: '100%',
      playerVars: {
        playsinline: 1,
        rel: 0,
        controls: 1,
        modestbranding: 1,
      },
      events: {
        onReady: () => playerReadyResolve(player),
        onStateChange: (e) => stateHandler(e),
        onError: (e) => stateHandler({ data: 'error', code: e.data }),
      },
    });
  }

  window.YTBridge = {
    parseInput,
    resolveHandle,
    fetchFeed,
    classifyShorts,
    isShort,
    loadPlayer,
    get player() { return player; },
    onState(fn) { stateHandler = fn; },
    play(videoId, startSeconds) {
      if (!player) return;
      player.loadVideoById({ videoId, startSeconds: startSeconds || 0 });
    },
    pause() { if (player && player.pauseVideo) player.pauseVideo(); },
    resume() { if (player && player.playVideo) player.playVideo(); },
    stop() { if (player && player.stopVideo) player.stopVideo(); },
    mute() { if (player && player.mute) player.mute(); },
    unMute() { if (player && player.unMute) player.unMute(); },
    lowQuality() {
      // רמז ליוטיוב להוריד איכות במצב האזנה (חוסך נתונים כשזה מכובד)
      try { if (player && player.setPlaybackQuality) player.setPlaybackQuality('small'); } catch (e) {}
    },
    currentTime() {
      try { return player && player.getCurrentTime ? player.getCurrentTime() : 0; }
      catch (e) { return 0; }
    },
  };
})();

// ===== רדיולי — Service Worker =====
const CACHE = 'radioli-v15';
// קבצים "ליבה" — קוד ומבנה. חייבים תמיד להיות עדכניים ומתואמים זה לזה,
// אחרת HTML ישן עם JS חדש (או להפך) שובר את הדף. תמיד רשת קודם.
const CORE = [
  './',
  'index.html',
  'css/styles.css',
  'js/config.js',
  'js/store.js',
  'js/youtube.js',
  'js/engine.js',
  'js/ui.js',
];
// קבצים סטטיים כבדים שכמעט לא משתנים — מטמון קודם, רענון ברקע.
const STATIC = [
  'js/vendor/lottie_light.min.js',
  'RADIOANIM.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // כל קובץ בנפרד: אם אחד נכשל (רשת רעועה), ההתקנה לא נופלת כולה
      // ונשארת תקועה על גרסה ישנה לצמיתות.
      Promise.all(CORE.concat(STATIC).map(url => c.add(url).catch(err => console.warn('sw cache miss', url, err))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // תוכן חי (פרוקסי, יוטיוב, פיירבייס) — תמיד מהרשת
  if (url.pathname.endsWith('proxy.php') || url.origin !== location.origin) return;

  const isCore = e.request.mode === 'navigate' || /\.(js|css)$/.test(url.pathname);

  if (isCore) {
    // רשת קודם, ורק אם באמת אין רשת — נופלים לעותק השמור.
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

// ===== רדיולי — שכבת נתונים (localStorage + Firebase אופציונלי) =====
(function () {
  const LS_KEY = 'radioli-data-v1';

  const DEFAULT_DATA = {
    channels: [], // {key, ytId, kind:'channel'|'playlist', title, role:'music'|'talk'|'news', moodIds:[]}
    moods: [
      { id: 'calm', emoji: '😌', name: 'רגוע' },
      { id: 'upbeat', emoji: '🔥', name: 'קצבי' },
      { id: 'happy', emoji: '🌞', name: 'אופטימי' },
    ],
    settings: {
      announceHour: true,
      newsEnabled: true,
      talkMinutes: 15,
      newsMinutes: 5,
      skipShorts: true,
      announceSound: 'bells',   // פעמונים | נבל | מרימבה | רך | בלי
      transitionSoundName: 'soft',
      videoMode: 'normal', // normal | mini | audio
    },
    activeMood: null, // null = הכול
  };

  let data = load();
  const listeners = [];
  let firebase = null; // {app, auth, db, user}

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return structuredClone(DEFAULT_DATA);
      const parsed = JSON.parse(raw);
      const merged = Object.assign(structuredClone(DEFAULT_DATA), parsed, {
        settings: Object.assign({}, DEFAULT_DATA.settings, parsed.settings || {}),
      });
      // מעבר מגרסה ישנה: המתג "צליל מעבר" הפך לבחירת צליל
      if (parsed.settings && parsed.settings.transitionSound === false && !parsed.settings.transitionSoundName) {
        merged.settings.transitionSoundName = 'none';
      }
      return merged;
    } catch (e) {
      console.warn('radioli: load failed', e);
      return structuredClone(DEFAULT_DATA);
    }
  }

  function persist() {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    if (firebase && firebase.user) cloudSave().catch(e => console.warn('cloud save failed', e));
    listeners.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
  }

  async function cloudSave() {
    const { doc, setDoc } = firebase.fs;
    await setDoc(doc(firebase.db, 'users', firebase.user.uid), {
      data: JSON.stringify(data),
      updatedAt: Date.now(),
    });
  }

  async function cloudLoad() {
    const { doc, getDoc } = firebase.fs;
    const snap = await getDoc(doc(firebase.db, 'users', firebase.user.uid));
    if (snap.exists()) {
      try {
        const cloud = JSON.parse(snap.data().data);
        // אם בענן יש ערוצים ובמקומי אין — לוקחים מהענן; אחרת המקומי מנצח ונשמר לענן
        if ((cloud.channels || []).length > 0 && data.channels.length === 0) {
          data = Object.assign(structuredClone(DEFAULT_DATA), cloud, {
            settings: Object.assign({}, DEFAULT_DATA.settings, cloud.settings || {}),
          });
          localStorage.setItem(LS_KEY, JSON.stringify(data));
          listeners.forEach(fn => fn(data));
          return;
        }
      } catch (e) { console.warn(e); }
    }
    await cloudSave();
  }

  // ---- Firebase (נטען רק אם יש קונפיגורציה) ----
  async function initFirebase(onUserChange) {
    if (!window.RADIOLI_FIREBASE_CONFIG) return null;
    try {
      const [appMod, authMod, fsMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
      ]);
      const app = appMod.initializeApp(window.RADIOLI_FIREBASE_CONFIG);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      firebase = { app, auth, db, user: null, authMod, fs: fsMod };
      authMod.onAuthStateChanged(auth, async (user) => {
        firebase.user = user;
        if (user) await cloudLoad().catch(e => console.warn(e));
        onUserChange(user);
      });
      return firebase;
    } catch (e) {
      console.error('radioli: firebase init failed', e);
      return null;
    }
  }

  async function login() {
    if (!firebase) return;
    const provider = new firebase.authMod.GoogleAuthProvider();
    await firebase.authMod.signInWithPopup(firebase.auth, provider);
  }

  async function logout() {
    if (!firebase) return;
    await firebase.authMod.signOut(firebase.auth);
  }

  function uid() {
    return 'k' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  }

  // ---- API ----
  window.Store = {
    get data() { return data; },
    subscribe(fn) { listeners.push(fn); },

    addChannel(ch) {
      ch.key = uid();
      ch.moodIds = ch.moodIds || [];
      data.channels.push(ch);
      persist();
      return ch;
    },
    removeChannel(key) {
      data.channels = data.channels.filter(c => c.key !== key);
      persist();
    },
    updateChannel(key, patch) {
      const ch = data.channels.find(c => c.key === key);
      if (ch) { Object.assign(ch, patch); persist(); }
    },
    toggleChannelMood(key, moodId) {
      const ch = data.channels.find(c => c.key === key);
      if (!ch) return;
      const i = ch.moodIds.indexOf(moodId);
      if (i >= 0) ch.moodIds.splice(i, 1); else ch.moodIds.push(moodId);
      persist();
    },

    addMood(name, emoji) {
      const m = { id: uid(), name, emoji: emoji || '🎧' };
      data.moods.push(m);
      persist();
      return m;
    },
    removeMood(id) {
      data.moods = data.moods.filter(m => m.id !== id);
      data.channels.forEach(c => { c.moodIds = c.moodIds.filter(x => x !== id); });
      if (data.activeMood === id) data.activeMood = null;
      persist();
    },
    setActiveMood(id) {
      data.activeMood = id;
      persist();
    },

    setSetting(key, val) {
      data.settings[key] = val;
      persist();
    },

    // ערוצים לפי תפקיד ומצב רוח פעיל, עם נפילה חכמה אם המצב ריק
    channelsFor(role) {
      let pool = data.channels.filter(c => c.role === role);
      if (data.activeMood) {
        const inMood = pool.filter(c => c.moodIds.includes(data.activeMood));
        if (inMood.length > 0) pool = inMood;
      }
      return pool;
    },

    initFirebase, login, logout,
    get user() { return firebase ? firebase.user : null; },
    get firebaseAvailable() { return !!window.RADIOLI_FIREBASE_CONFIG; },
  };
})();

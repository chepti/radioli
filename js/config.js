// ===== רדיולי — קונפיגורציה =====

// כדי להפעיל התחברות עם Google וסנכרון בין מכשירים:
// 1. יוצרים פרויקט ב-https://console.firebase.google.com
// 2. מפעילים Authentication → Google, ו-Firestore Database
// 3. מדביקים כאן את האובייקט firebaseConfig מהגדרות הפרויקט
// כל עוד הערך הוא null — האפליקציה עובדת במצב מקומי (localStorage) בלי חשבון.
window.RADIOLI_FIREBASE_CONFIG = null;
/* דוגמה:
window.RADIOLI_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "radioli-xxxx.firebaseapp.com",
  projectId: "radioli-xxxx",
  storageBucket: "radioli-xxxx.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
*/

// כתובת הפרוקסי שמביא נתוני ערוצים מיוטיוב (RSS). יחסי לאתר.
window.RADIOLI_PROXY = 'proxy.php';

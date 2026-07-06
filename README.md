# רדיולי 📻 — הרדיו האישי שלי

PWA
של רדיו אישי: מוסיפים ערוצי יוטיוב אהובים (מוזיקה, דיבורים, חדשות) — ולוחצים על כפתור אחד.

## איך זה עובד

- **הפעלה** — כרוזת שעה בעברית (צליל פתיחה + הקראה), ואז השידור מתחיל.
- **שעה עגולה** — כרוזת שעה + מהדורת חדשות (הסרטון האחרון מערוץ החדשות שבחרת, עד X דקות).
- **דיבורים** — כרבע שעה (ניתן לשינוי) מסרטון מערוצי הדיבורים. המיקום נשמר — אחרי שיר חוזרים בדיוק לאותה נקודה.
- **שיר** — סרטון אקראי מערוצי המוזיקה, ובסופו חוזרים לדיבורים.
- **מצבי רוח** — יוצרים מצב רוח (רגוע / קצבי / אופטימי…), מתייגים ערוצים, ומחליפים בלחיצה תוך כדי שידור.

## מבנה

| קובץ | תפקיד |
|------|--------|
| `index.html` | המסכים: רדיו, הגדרות, וילון נגן |
| `js/engine.js` | מנוע לוח השידורים (שעון, חדשות, דיבורים, שירים) |
| `js/youtube.js` | נגן יוטיוב + קריאת RSS של ערוצים דרך הפרוקסי |
| `js/store.js` | שמירת נתונים — localStorage, ואם מוגדר גם Firebase |
| `js/ui.js` | הממשק |
| `proxy.php` | פרוקסי קטן בצד השרת שמביא RSS מיוטיוב (בלי מפתח API) |
| `sw.js` + `manifest.webmanifest` | PWA — התקנה על מסך הבית |

## חיבור Firebase (התחברות עם Google וסנכרון)

1. יוצרים פרויקט ב-
https://console.firebase.google.com
2. ב-
Authentication → Sign-in method
מפעילים
Google
3. ב-
Authentication → Settings → Authorized domains
מוסיפים את
`chepti.com`
4. יוצרים
Firestore Database
(מצב Production)
עם החוקים:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

5. ב-
Project settings → Your apps → Web app
מעתיקים את
`firebaseConfig`
ומדביקים בקובץ
[js/config.js](js/config.js)
במקום ה-
`null`

בלי Firebase — הכול עובד מקומית על המכשיר.

## הרצה מקומית

הפרוקסי דורש
PHP,
לכן מקומית מריצים:

```
php -S localhost:8080
```

או פשוט משתמשים בגרסה שעל השרת.

## פריסה

```powershell
scp -r -F "T:\.ssh\config" index.html css js icons proxy.php manifest.webmanifest sw.js README.md hostinger:/home/u630483490/public_html/radio/
```

הערה: כשמעדכנים קבצים, להעלות מחדש ולהעלות גרסה ב-
`sw.js`
(`radioli-v1` → `radioli-v2`)
כדי שהמטמון יתרענן.

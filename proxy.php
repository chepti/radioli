<?php
// ===== רדיולי — פרוקסי קטן ליוטיוב =====
// שני מצבים בלבד, עם ולידציה קפדנית (רק youtube.com):
//   proxy.php?feed=channel&id=UC...    -> RSS של ערוץ
//   proxy.php?feed=playlist&id=PL...   -> RSS של פלייליסט
//   proxy.php?resolve=@handle          -> JSON עם channelId של הערוץ

header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

function fetch_url($url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 4,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        CURLOPT_HTTPHEADER => ['Accept-Language: he,en;q=0.8', 'Cookie: SOCS=CAI'],
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code >= 400) return null;
    return $body;
}

function fail($msg, $code = 400) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- RSS ----
if (isset($_GET['feed'])) {
    $type = $_GET['feed'];
    $id = isset($_GET['id']) ? trim($_GET['id']) : '';
    if ($type === 'channel' && preg_match('/^UC[\w-]{22}$/', $id)) {
        $url = 'https://www.youtube.com/feeds/videos.xml?channel_id=' . $id;
    } elseif ($type === 'playlist' && preg_match('/^[A-Za-z0-9_-]{10,60}$/', $id)) {
        $url = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' . $id;
    } else {
        fail('bad feed params');
    }
    $body = fetch_url($url);
    if ($body === null) fail('feed fetch failed', 502);
    header('Content-Type: application/xml; charset=utf-8');
    echo $body;
    exit;
}

// ---- זיהוי שורטס ----
// proxy.php?shorts=id1,id2,...  ->  {"id1":true,"id2":false}
// שורט: /shorts/{id} מחזיר 200. סרטון רגיל: הפניה (3xx) ל-watch.
if (isset($_GET['shorts'])) {
    $ids = array_slice(array_filter(array_map('trim', explode(',', $_GET['shorts'])), function ($id) {
        return preg_match('/^[\w-]{11}$/', $id);
    }), 0, 30);
    if (!$ids) fail('bad video ids');
    $out = [];
    foreach ($ids as $id) {
        // בכוונה בלי User-Agent של דפדפן: עם UA של דפדפן יוטיוב מפנה לדף
        // אישור עוגיות (consent) מהשרת באירופה, וזה מקלקל את הזיהוי.
        $ch = curl_init('https://www.youtube.com/shorts/' . $id);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_NOBODY => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $redir = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        curl_close($ch);
        if ($code === 200) $out[$id] = true;
        elseif ($code >= 300 && $code < 400 && strpos($redir, '/watch') !== false) $out[$id] = false;
        else $out[$id] = null; // לא ידוע (למשל הפניית consent) — הצד השני לא יסנן
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($out);
    exit;
}

// ---- Resolve handle -> channelId ----
if (isset($_GET['resolve'])) {
    $q = trim($_GET['resolve']);
    // צורות קלט: "@handle" | "handle" | "user:name" | "c:name"
    $path = null;
    if (preg_match('/^user:([\w.\-]{1,60})$/', $q, $m)) {
        $path = 'user/' . $m[1];
    } elseif (preg_match('/^c:([\w.\-]{1,60})$/', $q, $m)) {
        $path = 'c/' . $m[1];
    } elseif (preg_match('/^@?([\w.\-]{1,60})$/', $q, $m)) {
        $path = '@' . $m[1];
    } else {
        fail('bad handle');
    }
    $html = fetch_url('https://www.youtube.com/' . rawurlencode($path));
    if ($html === null && $path[0] === '@') {
        // אולי זה בעצם שם ישן של ערוץ
        $html = fetch_url('https://www.youtube.com/c/' . rawurlencode(substr($path, 1)));
    }
    if ($html === null) fail('channel not found', 404);

    $channelId = null;
    if (preg_match('/"channelId":"(UC[\w-]{22})"/', $html, $m)) $channelId = $m[1];
    elseif (preg_match('/channel_id=(UC[\w-]{22})/', $html, $m)) $channelId = $m[1];
    if (!$channelId) fail('channel id not found in page', 404);

    $title = '';
    if (preg_match('/<meta property="og:title" content="([^"]*)"/', $html, $m)) {
        $title = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
    }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['channelId' => $channelId, 'title' => $title], JSON_UNESCAPED_UNICODE);
    exit;
}

fail('missing params');

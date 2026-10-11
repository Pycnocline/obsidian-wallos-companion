<?php
/** Wallos Companion pairing bridge. Requires existing Wallos PHP session and SQLite. */
declare(strict_types=1);
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
require_once __DIR__ . '/includes/connect.php';

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params(['lifetime' => 30 * 86400, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}
$now = time();
$pairDb = new SQLite3(__DIR__ . '/db/obsidian_pairing.db');
$pairDb->busyTimeout(1000);
$pairDb->exec('CREATE TABLE IF NOT EXISTS pairs (id TEXT PRIMARY KEY, verifier_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, approved_user INTEGER NULL)');
$pairDb->exec('DELETE FROM pairs WHERE expires_at < ' . ($now - 120));

function respond(int $status, array $payload): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}
function validId(string $id): bool { return preg_match('/^[a-f0-9]{32}$/D', $id) === 1; }
function lookup(SQLite3 $db, string $id): ?array {
    $stmt = $db->prepare('SELECT id, verifier_hash, expires_at, approved_user FROM pairs WHERE id = :id');
    $stmt->bindValue(':id', $id, SQLITE3_TEXT);
    $record = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    return $record ?: null;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $action = (string) $_POST['action'];
    if ($action === 'start') {
        $verifier = (string) ($_POST['verifier'] ?? '');
        if (!preg_match('/^[0-9a-f]{64}$/D', $verifier)) respond(400, ['success' => false, 'error' => '无效配对验证器']);
        $count = (int) $pairDb->querySingle('SELECT COUNT(*) FROM pairs');
        if ($count >= 64) respond(429, ['success' => false, 'error' => '配对请求过多，请稍后再试']);
        $id = bin2hex(random_bytes(16));
        $stmt = $pairDb->prepare('INSERT INTO pairs (id, verifier_hash, created_at, expires_at) VALUES (:id, :hash, :created, :expires)');
        $stmt->bindValue(':id', $id, SQLITE3_TEXT);
        $stmt->bindValue(':hash', hash('sha256', $verifier), SQLITE3_TEXT);
        $stmt->bindValue(':created', $now, SQLITE3_INTEGER);
        $stmt->bindValue(':expires', $now + 600, SQLITE3_INTEGER);
        $stmt->execute();
        respond(200, ['success' => true, 'id' => $id, 'expires_in' => 600]);
    }
    if ($action === 'claim') {
        $id = (string) ($_POST['id'] ?? '');
        $verifier = (string) ($_POST['verifier'] ?? '');
        if (!validId($id) || !preg_match('/^[0-9a-f]{64}$/D', $verifier)) respond(400, ['success' => false, 'error' => '无效配对凭据']);
        $row = lookup($pairDb, $id);
        if (!$row || (int) $row['expires_at'] < $now) respond(200, ['success' => true, 'status' => 'expired']);
        if (!hash_equals($row['verifier_hash'], hash('sha256', $verifier))) respond(403, ['success' => false, 'error' => '配对验证失败']);
        if ($row['approved_user'] === null) respond(200, ['success' => true, 'status' => 'pending']);
        $stmt = $db->prepare('SELECT api_key FROM user WHERE id = :id');
        $stmt->bindValue(':id', (int) $row['approved_user'], SQLITE3_INTEGER);
        $user = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
        if (!$user || empty($user['api_key'])) respond(409, ['success' => false, 'error' => 'Wallos 用户尚未配置 API Key']);
        $del = $pairDb->prepare('DELETE FROM pairs WHERE id = :id AND approved_user IS NOT NULL');
        $del->bindValue(':id', $id, SQLITE3_TEXT);
        $del->execute();
        if ($pairDb->changes() !== 1) respond(409, ['success' => false, 'error' => '配对已被领取']);
        respond(200, ['success' => true, 'status' => 'approved', 'api_key' => $user['api_key']]);
    }
    if ($action === 'approve') {
        $id = (string) ($_POST['id'] ?? '');
        $nonce = (string) ($_POST['csrf'] ?? '');
        $userId = (int) ($_SESSION['userId'] ?? 0);
        if ($userId <= 0 || ($_SESSION['loggedin'] ?? false) !== true) { http_response_code(401); exit('请先登录 Wallos'); }
        if (!validId($id) || !preg_match('/^[a-f0-9]{48}$/D', $nonce) || !isset($_SESSION['wallos_pair_csrf'], $_SESSION['wallos_pair_id']) || !hash_equals((string) $_SESSION['wallos_pair_csrf'], $nonce) || !hash_equals((string) $_SESSION['wallos_pair_id'], $id)) { http_response_code(403); exit('授权校验失败'); }
        $stmt = $pairDb->prepare('UPDATE pairs SET approved_user = :user WHERE id = :id AND expires_at >= :now AND approved_user IS NULL');
        $stmt->bindValue(':id', $id, SQLITE3_TEXT);
        $stmt->bindValue(':user', $userId, SQLITE3_INTEGER);
        $stmt->bindValue(':now', $now, SQLITE3_INTEGER);
        $stmt->execute();
        if ($pairDb->changes() !== 1) { http_response_code(410); exit('配对过期或已授权'); }
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wallos 已授权</title><p>已授权本次 Obsidian 登录。请回到 Obsidian，点击「完成连接」。</p>';
        exit;
    }
    respond(400, ['success' => false, 'error' => '不支持的操作']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') { http_response_code(405); exit; }
$id = (string) ($_GET['id'] ?? '');
$row = validId($id) ? lookup($pairDb, $id) : null;
if (!$row || (int) $row['expires_at'] < $now) { http_response_code(410); exit('配对链接已过期'); }
if (($_SESSION['loggedin'] ?? false) !== true || !isset($_SESSION['userId'])) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wallos 登录</title><p>请先登录 Wallos，再返回 Obsidian 点击「授权此设备」。</p><p><a href="/login.php">登录 Wallos / Cloudflare</a></p>';
    exit;
}
$csrf = bin2hex(random_bytes(24));
$_SESSION['wallos_pair_csrf'] = $csrf;
$_SESSION['wallos_pair_id'] = $id;
header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权 Obsidian</title>';
echo '<h2>授权 Wallos Companion</h2><p>允许此设备通过 API Key 管理当前 Wallos 账户的订阅，包括新增、修改和删除。</p>';
echo '<p>如果这不是你刚刚在 Obsidian 发起的操作，请勿授权。</p>';
echo '<form action="/obsidian-pair.php" method="post"><input type="hidden" name="action" value="approve"><input type="hidden" name="id" value="' . htmlspecialchars($id, ENT_QUOTES) . '"><input type="hidden" name="csrf" value="' . htmlspecialchars($csrf, ENT_QUOTES) . '"><button type="submit">确认授权此设备</button></form>';

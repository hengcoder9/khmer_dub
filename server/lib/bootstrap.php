<?php
// KhmerDub account & subscription server — shared core (config, DB, JSON, auth, subscription logic).
declare(strict_types=1);

const KD_ROOT = __DIR__ . '/..';

if (!is_file(KD_ROOT . '/config.php')) {
    http_response_code(503);
    header('content-type: application/json');
    echo json_encode(['error' => 'Server not installed — run install.php']);
    exit;
}
$GLOBALS['KD_CFG'] = require KD_ROOT . '/config.php';
date_default_timezone_set('UTC');

function cfg(string $key, $default = null)
{
    return $GLOBALS['KD_CFG'][$key] ?? $default;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = cfg('db');
    $pdo = new PDO(
        "mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset=utf8mb4",
        $c['user'],
        $c['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
    );
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

function row(string $sql, array $args = []): ?array
{
    $r = q($sql, $args)->fetch();
    return $r === false ? null : $r;
}

function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

// ───────────── HTTP helpers ─────────────

class ApiError extends Exception
{
    public function __construct(string $msg, public int $status = 400)
    {
        parent::__construct($msg);
    }
}

function fail(string $msg, int $status = 400): never
{
    throw new ApiError($msg, $status);
}

function json_out($data, int $status = 200): never
{
    http_response_code($status);
    header('content-type: application/json; charset=utf-8');
    header('cache-control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array
{
    static $b = null;
    if ($b !== null) return $b;
    $raw = file_get_contents('php://input') ?: '';
    $b = $raw === '' ? [] : json_decode($raw, true);
    if (!is_array($b)) fail('Invalid JSON body');
    return $b;
}

function str_in(string $key, int $max = 200, bool $required = true): string
{
    $v = trim((string)(body()[$key] ?? ''));
    if ($required && $v === '') fail("Missing $key");
    if (mb_strlen($v) > $max) fail("$key is too long");
    return $v;
}

function client_ip(): string
{
    return substr($_SERVER['REMOTE_ADDR'] ?? '', 0, 45);
}

function setting(string $k, $default = null)
{
    $r = row('SELECT v FROM settings WHERE k = ?', [$k]);
    return $r ? $r['v'] : $default;
}

function set_setting(string $k, string $v): void
{
    q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$k, $v]);
}

function audit(?int $userId, string $action, string $target = '', $detail = null): void
{
    q('INSERT INTO audit_log (user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)', [
        $userId, $action, $target, $detail === null ? null : json_encode($detail, JSON_UNESCAPED_UNICODE), client_ip(), now()
    ]);
}

// ───────────── auth ─────────────

function bearer(): string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!$h && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strcasecmp($k, 'authorization') === 0) $h = $v;
    }
    if (preg_match('/^Bearer\s+([A-Za-z0-9]+)$/', trim($h), $m)) return $m[1];
    return '';
}

function new_session(int $userId, string $device): string
{
    $token = bin2hex(random_bytes(32));
    $days = (int)cfg('session_days', 60);
    q('INSERT INTO sessions (user_id, token_hash, device, ip, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?)', [
        $userId, hash('sha256', $token), mb_substr($device, 0, 120), client_ip(), now(), now(), gmdate('Y-m-d H:i:s', time() + $days * 86400)
    ]);
    q('UPDATE users SET last_login_at = ?, last_device = ? WHERE id = ?', [now(), mb_substr($device, 0, 120), $userId]);
    return $token;
}

/** Signed-in user (or 401). */
function auth_user(): array
{
    $t = bearer();
    if ($t === '') fail('Sign in required', 401);
    $s = row('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', [hash('sha256', $t), now()]);
    if (!$s) fail('Session expired — sign in again', 401);
    $u = row('SELECT * FROM users WHERE id = ?', [$s['user_id']]);
    if (!$u) fail('Account not found', 401);
    if ($u['status'] !== 'active') fail('This account is disabled. Contact support.', 403);
    if (strtotime($s['last_seen_at']) < time() - 300) q('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now(), $s['id']]);
    $u['_session'] = (int)$s['id'];
    return $u;
}

function admin_user(): array
{
    $u = auth_user();
    if ($u['role'] !== 'admin') fail('Admins only', 403);
    return $u;
}

/** Simple brute-force guard: max 8 failed sign-ins per email+IP per 15 minutes. */
function check_throttle(string $email): void
{
    $n = row('SELECT COUNT(*) n FROM login_failures WHERE (email = ? OR ip = ?) AND at > ?', [$email, client_ip(), gmdate('Y-m-d H:i:s', time() - 900)])['n'];
    if ($n >= 8) fail('Too many attempts — wait 15 minutes and try again', 429);
}

function public_user(array $u): array
{
    return [
        'id' => (int)$u['id'],
        'email' => $u['email'],
        'name' => $u['name'],
        'role' => $u['role'],
        'status' => $u['status'],
        'createdAt' => $u['created_at'],
        // how the account signs in (Google / Telegram accounts may have no password)
        'provider' => $u['auth_provider'] ?? 'email',
        'google' => !empty($u['google_sub']),
        'telegram' => !empty($u['telegram_id']) ? ($u['telegram_username'] ?? '') ?: 'connected' : null,
        'avatar' => $u['avatar_url'] ?? null,
        'hasPassword' => ($u['password_hash'] ?? '') !== '',
    ];
}

// ───────────── subscriptions ─────────────

function plan_by_id(int $id): ?array
{
    return row('SELECT * FROM plans WHERE id = ?', [$id]);
}

function public_plan(array $p): array
{
    return [
        'id' => (int)$p['id'],
        'code' => $p['code'],
        'name' => $p['name'],
        'months' => $p['months'] === null ? null : (int)$p['months'],
        'priceUsd' => (float)$p['price_usd'],
        'priceKhr' => (int)$p['price_khr'],
        'badge' => $p['badge'],
        'enabled' => (bool)$p['enabled'],
    ];
}

/**
 * Current access for a user: lifetime > latest paid end > trial.
 * { active, kind: 'lifetime'|'paid'|'trial'|'none', plan, endsAt, daysLeft, trialEndsAt }
 */
function access_of(array $u): array
{
    $life = row("SELECT s.*, p.name plan_name, p.code plan_code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                 WHERE s.user_id = ? AND s.ends_at IS NULL AND s.revoked = 0 LIMIT 1", [$u['id']]);
    if ($life) return ['active' => true, 'kind' => 'lifetime', 'plan' => $life['plan_name'], 'planCode' => $life['plan_code'], 'endsAt' => null, 'daysLeft' => null, 'trialEndsAt' => $u['trial_ends_at']];
    $sub = row("SELECT s.*, p.name plan_name, p.code plan_code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                WHERE s.user_id = ? AND s.revoked = 0 AND s.ends_at > ? ORDER BY s.ends_at DESC LIMIT 1", [$u['id'], now()]);
    if ($sub) {
        $left = (strtotime($sub['ends_at']) - time()) / 86400;
        return ['active' => true, 'kind' => 'paid', 'plan' => $sub['plan_name'], 'planCode' => $sub['plan_code'], 'endsAt' => $sub['ends_at'], 'daysLeft' => (int)ceil($left), 'trialEndsAt' => $u['trial_ends_at']];
    }
    if ($u['trial_ends_at'] && strtotime($u['trial_ends_at']) > time()) {
        $left = (strtotime($u['trial_ends_at']) - time()) / 86400;
        return ['active' => true, 'kind' => 'trial', 'plan' => 'Free trial', 'planCode' => 'trial', 'endsAt' => $u['trial_ends_at'], 'daysLeft' => (int)ceil($left), 'trialEndsAt' => $u['trial_ends_at']];
    }
    return ['active' => false, 'kind' => 'none', 'plan' => null, 'planCode' => null, 'endsAt' => null, 'daysLeft' => 0, 'trialEndsAt' => $u['trial_ends_at']];
}

/** Add a plan to a user. Time stacks: a new 3-month plan starts when the current one ends. */
function grant_plan(int $userId, array $plan, string $source, ?int $orderId = null, string $note = ''): array
{
    $start = now();
    $end = null;
    if ($plan['months'] !== null) {
        $cur = row('SELECT MAX(ends_at) e FROM subscriptions WHERE user_id = ? AND revoked = 0 AND ends_at > ?', [$userId, now()]);
        if ($cur && $cur['e']) $start = $cur['e'];
        $d = new DateTime($start, new DateTimeZone('UTC'));
        $d->modify('+' . (int)$plan['months'] . ' months');
        $end = $d->format('Y-m-d H:i:s');
    }
    q('INSERT INTO subscriptions (user_id, plan_id, starts_at, ends_at, source, order_id, note, created_at) VALUES (?,?,?,?,?,?,?,?)', [
        $userId, $plan['id'], $start, $end, $source, $orderId, mb_substr($note, 0, 250), now()
    ]);
    return ['startsAt' => $start, 'endsAt' => $end];
}

/** Mark an order paid exactly once and grant its plan. Returns true if this call did it. */
function complete_order(array $order, string $providerRef = '', $raw = null): bool
{
    $st = q("UPDATE orders SET status = 'paid', paid_at = ?, provider_ref = COALESCE(NULLIF(?, ''), provider_ref), raw = COALESCE(?, raw) WHERE id = ? AND status = 'pending'", [
        now(), $providerRef, $raw === null ? null : json_encode($raw, JSON_UNESCAPED_UNICODE), $order['id']
    ]);
    if ($st->rowCount() !== 1) return false;
    $plan = plan_by_id((int)$order['plan_id']);
    grant_plan((int)$order['user_id'], $plan, 'payment', (int)$order['id']);
    audit((int)$order['user_id'], 'order.paid', 'order:' . $order['id'], ['amount' => $order['amount'], 'currency' => $order['currency'], 'ref' => $providerRef]);
    return true;
}

function public_order(array $o): array
{
    return [
        'id' => (int)$o['id'],
        'ref' => $o['ref'],
        'planId' => (int)$o['plan_id'],
        'amount' => (float)$o['amount'],
        'currency' => $o['currency'],
        'status' => $o['status'],
        'provider' => $o['provider'],
        'qr' => $o['qr_string'],
        'qrImage' => $o['qr_image'],
        'payUrl' => $o['pay_url'],
        'expiresAt' => $o['expires_at'],
        'paidAt' => $o['paid_at'],
        'createdAt' => $o['created_at'],
    ];
}

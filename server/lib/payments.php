<?php
// Payment providers. Each provider turns an order into something the customer can pay (a KHQR / deep link)
// and later tells us whether it was paid.
//
//  manual     — the customer scans the shop's static KHQR (image set in Admin → Settings), types the order
//               reference in the transfer note, and an admin confirms the order in the admin panel.
//  anajakpay  — AnajakPay KHQR (ABA): in-app QR API or the hosted checkout page; confirmed by the signed
//               callback or Check Transaction V2 polling. Credentials: Admin → Settings → AnajakPay.
declare(strict_types=1);

function payment_mode(): string
{
    $m = setting('payment_mode', 'manual');
    return in_array($m, ['manual', 'anajakpay'], true) ? $m : 'manual';
}

/** @return array{qr_string:?string, qr_image:?string, pay_url:?string, provider_ref:?string, expires_at:string} */
function payment_create(array $order, array $plan): array
{
    if (payment_mode() === 'anajakpay') return anajakpay_create($order, $plan);
    return [
        'qr_string' => null,
        'qr_image' => setting('manual_qr_image') ?: null, // data: URL or https URL of the shop's static KHQR
        'pay_url' => null,
        'provider_ref' => null,
        'expires_at' => gmdate('Y-m-d H:i:s', time() + 48 * 3600),
    ];
}

/** 'paid' | 'pending' | 'expired' — polled by the app while the QR is on screen. */
function payment_check(array $order, bool $force = false, ?string &$note = null): string
{
    if ($order['status'] !== 'pending') return $order['status'];
    $expired = strtotime($order['expires_at']) < time();
    if ($order['provider'] === 'anajakpay') {
        // check even just after expiry: a customer may have paid in the last seconds
        $r = anajakpay_check($order, $force);
        $note = $r['note'] ?? null;
        if ($r['paid']) {
            complete_order($order, $r['ref'] ?? '', $r['raw'] ?? null);
            return 'paid';
        }
    }
    if ($expired) {
        q("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'", [$order['id']]);
        return 'expired';
    }
    return 'pending'; // manual orders wait for an admin
}

// ───────────── AnajakPay (KHQR CC / ABA QR API) ─────────────
// POST https://anajakpay.com/api/{api_key}/payment-gateway/v1/payments/qr-api-khqrcc   (form-urlencoded)
//   transaction_id, amount, success_url, remark, hash = sha1(secret . transaction_id . amount . success_url . remark)
// → { responseCode: 0, data: { transaction_id, amount, qr (EMV string), qr_url (PNG), md5, hash } }
//
// Payment confirmation: AnajakPay calls `success_url` when the QR is paid. We make that URL unguessable per order
// (HMAC of the order reference with our secret) so only AnajakPay can trigger it.
// config.php → 'anajakpay' => ['api_key' => '<key from the URL path>', 'secret' => '<secret key>',
//                              'public_api_url' => 'https://your-domain/khmerdub/api/']

const ANAJAKPAY_BASE = 'https://anajakpay.com/api/';

/**
 * Credentials: Admin → Settings (stored in the settings table) override config.php → 'anajakpay'.
 * The secret never leaves the server — the admin API only reports whether it is set.
 */
function anajakpay_creds(): array
{
    $c = cfg('anajakpay', []);
    foreach (['api_key' => 'anajakpay_api_key', 'secret' => 'anajakpay_secret', 'public_api_url' => 'anajakpay_public_url'] as $k => $s) {
        $v = (string)setting($s, '');
        if ($v !== '') $c[$k] = $v;
    }
    return $c;
}

function anajakpay_ready(): bool
{
    $c = anajakpay_creds();
    return !empty($c['api_key']) && !empty($c['secret']);
}

function anajakpay_cfg(): array
{
    $c = anajakpay_creds();
    if (empty($c['api_key']) || empty($c['secret'])) fail('AnajakPay is not configured — add the profile ID and secret key in Admin → Settings → AnajakPay. Use manual mode meanwhile.', 503);
    if (!preg_match('/^[A-Za-z0-9_-]{8,128}$/', $c['api_key'])) fail('AnajakPay profile ID looks wrong — check Admin → Settings → AnajakPay', 500);
    return $c;
}

/** Public address of this API (…/api/), as AnajakPay must reach it. */
function anajakpay_public_base(): string
{
    $base = (string)(anajakpay_creds()['public_api_url'] ?? '');
    if (!$base) {
        // fall back to the URL this request came in on
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
        $base = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . preg_replace('#/index\.php$#', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php') . '/');
    }
    return rtrim($base, '/') . '/';
}

/** The URL to paste into AnajakPay → Settings → Webhook URL. */
function anajakpay_webhook_url(): string
{
    return anajakpay_public_base() . 'pay/webhook/anajakpay';
}

/**
 * Admin "Test connection": a status check for a made-up order. A wrong secret answers "Invalid Security Hash";
 * anything else signed correctly means the profile ID + secret work. Costs one request from the 50/min budget.
 */
function anajakpay_test(): array
{
    $c = anajakpay_cfg();
    if ($w = anajakpay_blocked()) return ['ok' => false, 'message' => "AnajakPay asked us to wait — try again in {$w} s."];
    $tid = 'KDTEST' . bin2hex(random_bytes(4));
    [$code, $headers, $res] = anajakpay_post('check-transv2-khqrcc', ['transaction_id' => $tid, 'hash' => sha1($c['secret'] . $tid)]);
    if ($code === 0) return ['ok' => false, 'message' => 'Could not reach anajakpay.com from this server (no internet or blocked outgoing HTTPS).'];
    if ($code === 429) return ['ok' => false, 'message' => 'Rate limited — try again in ' . anajakpay_block($headers) . ' s.'];
    $msg = is_array($res) ? (string)($res['responseMessage'] ?? '') : '';
    if (stripos($msg, 'hash') !== false) return ['ok' => false, 'message' => "AnajakPay rejected the secret key ($msg). Copy it again from the AnajakPay portal."];
    if ($code === 404 || !is_array($res)) return ['ok' => false, 'message' => "Unexpected reply (HTTP $code) — check the profile ID."];
    if (stripos($msg, 'merchant') !== false || stripos($msg, 'profile') !== false || stripos($msg, 'not configured') !== false) return ['ok' => false, 'message' => "AnajakPay: $msg"];
    return ['ok' => true, 'message' => 'Connected — the profile ID and secret key are accepted' . ($msg !== '' ? " (test reply: $msg)" : '') . '.'];
}

/** Amount the way PHP casts a float to string: 2.50 → "2.5", 24.00 → "24" (it is part of the signed string). */
function anajakpay_amount($amount): string
{
    return (string)(float)$amount;
}

function anajakpay_sign(string $secret, string $tid, string $amount, string $successUrl, string $remark): string
{
    return sha1($secret . $tid . $amount . $successUrl . $remark);
}

/** Per-order callback token: only someone holding our secret can produce it. */
function anajakpay_callback_token(string $ref): string
{
    return substr(hash_hmac('sha256', 'cb:' . $ref, anajakpay_cfg()['secret']), 0, 40);
}

function anajakpay_success_url(string $ref): string
{
    return anajakpay_webhook_url() . '?ref=' . rawurlencode($ref) . '&t=' . anajakpay_callback_token($ref);
}

function anajakpay_create(array $order, array $plan): array
{
    $c = anajakpay_cfg();
    if ($order['currency'] !== 'USD') fail('AnajakPay QR orders are in USD — set Admin → Settings → Currency to USD.', 400);
    $data = [
        'transaction_id' => $order['ref'],
        'amount' => anajakpay_amount($order['amount']),
        'success_url' => anajakpay_success_url($order['ref']),
        'remark' => 'KD' . $order['user_id'] . '-' . $plan['code'], // no personal data
    ];
    $data['hash'] = anajakpay_sign($c['secret'], $data['transaction_id'], $data['amount'], $data['success_url'], $data['remark']);

    // Hosted checkout (requestv2): the buyer opens AnajakPay's page (KHQR + "Open in ABA Mobile").
    // Same signature as the QR API; no API call here, so it costs nothing from the 50 req/min budget.
    // The page redirects the browser to success_url with success_hash — verified in anajakpay_webhook().
    if (setting('anajakpay_flow', 'qr') === 'checkout') {
        return [
            'qr_string' => null,
            'qr_image' => null,
            'pay_url' => 'https://anajakpay.com/api/payment/requestv2/' . rawurlencode($c['api_key']) . '?' . http_build_query($data, '', '&', PHP_QUERY_RFC3986),
            'provider_ref' => null,
            'expires_at' => gmdate('Y-m-d H:i:s', time() + 30 * 60),
        ];
    }

    if ($w = anajakpay_blocked()) fail("The payment service is busy — try again in {$w} s.", 429);
    [$code, $headers, $res] = anajakpay_post('qr-api-khqrcc', $data);
    if ($code === 0) fail('Payment provider unreachable — check the internet connection and try again.', 502);
    // 50 requests/min per merchant (failed ones count too)
    if ($code === 429) {
        $wait = anajakpay_block($headers);
        fail("The payment service is busy — try again in {$wait} s.", 429);
    }
    if (!is_array($res) || ($res['responseCode'] ?? -1) !== 0 || empty($res['data']['qr'])) {
        error_log('[khmerdub] anajakpay create failed ' . $code . ': ' . substr((string)json_encode($res), 0, 500));
        fail('Payment provider error: ' . (is_array($res) ? ($res['responseMessage'] ?? "HTTP $code") : "HTTP $code"), 502);
    }
    $d = $res['data'];
    q('UPDATE orders SET raw = ? WHERE id = ?', [json_encode(['create' => $res], JSON_UNESCAPED_UNICODE), $order['id']]);
    return [
        'qr_string' => (string)$d['qr'],
        'qr_image' => isset($d['qr_url']) && str_starts_with((string)$d['qr_url'], 'https://') ? (string)$d['qr_url'] : null,
        'pay_url' => null,
        'provider_ref' => isset($d['md5']) ? (string)$d['md5'] : null,
        'expires_at' => gmdate('Y-m-d H:i:s', time() + 15 * 60), // KHQR codes are short-lived
    ];
}

// AnajakPay allows 50 requests/min for the whole merchant (create + check, all customers together).
const ANAJAKPAY_ORDER_GAP = 6;   // seconds between status checks of one order
const ANAJAKPAY_GLOBAL_GAP = 2;  // seconds between any two status checks (≤ 30/min, leaves room for creates)

function anajakpay_blocked(): int
{
    return max(0, (int)setting('anajakpay_blocked_until', '0') - time());
}

function anajakpay_block(string $headers): int
{
    $wait = preg_match('/^Retry-After:\s*(\d+)/mi', $headers, $m) ? max(1, (int)$m[1]) : 60;
    set_setting('anajakpay_blocked_until', (string)(time() + $wait));
    return $wait;
}

/** POST form data to an AnajakPay endpoint → [httpCode, headers, decoded JSON|null] */
function anajakpay_post(string $endpoint, array $data): array
{
    $c = anajakpay_cfg();
    // 'base_url' only for tests against a local mock; production uses anajakpay.com
    $ch = curl_init(($c['base_url'] ?? '' ?: ANAJAKPAY_BASE) . $c['api_key'] . '/payment-gateway/v1/payments/' . $endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($data),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hlen = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    if ($resp === false) return [0, '', null];
    return [$code, substr((string)$resp, 0, $hlen), json_decode(substr((string)$resp, $hlen), true)];
}

/**
 * Check Transaction V2: POST …/check-transv2-khqrcc { transaction_id, hash = sha1(secret + transaction_id) }
 * → data.status "pending" | "success" (+ amount "2.50"). Throttled per order and merchant-wide; any error keeps the
 * order pending (the signed callback can still complete it).
 */
function anajakpay_check(array $order, bool $force = false): array
{
    if (anajakpay_blocked() > 0) return ['paid' => false, 'note' => 'rate limited'];
    $meta = json_decode((string)($order['raw'] ?? ''), true) ?: [];
    // $force (admin "Check now") skips the per-order gap, never the merchant-wide one
    if (!$force && time() - (int)($meta['last_check'] ?? 0) < ANAJAKPAY_ORDER_GAP) return ['paid' => false];
    $now = microtime(true);
    if ($now - (float)setting('anajakpay_last_check', '0') < ANAJAKPAY_GLOBAL_GAP) return ['paid' => false, 'note' => 'busy, try again in a moment'];
    set_setting('anajakpay_last_check', (string)$now);
    $meta['last_check'] = time();
    q('UPDATE orders SET raw = ? WHERE id = ?', [json_encode($meta, JSON_UNESCAPED_UNICODE), $order['id']]);

    $c = anajakpay_cfg();
    [$code, $headers, $res] = anajakpay_post('check-transv2-khqrcc', ['transaction_id' => $order['ref'], 'hash' => sha1($c['secret'] . $order['ref'])]);
    if ($code === 429) {
        anajakpay_block($headers);
        return ['paid' => false];
    }
    if (!is_array($res) || ($res['responseCode'] ?? -1) !== 0) {
        error_log('[khmerdub] anajakpay check ' . $order['ref'] . " HTTP $code: " . substr(json_encode($res), 0, 300));
        return ['paid' => false];
    }
    $d = $res['data'] ?? [];
    if (strtolower((string)($d['status'] ?? '')) !== 'success') return ['paid' => false, 'note' => 'AnajakPay: ' . ((string)($d['status'] ?? '') ?: 'not paid')];
    if (round((float)($d['amount'] ?? 0), 2) !== round((float)$order['amount'], 2)) {
        audit((int)$order['user_id'], 'anajakpay.amount.mismatch', 'order:' . $order['id'], ['paid' => $d['amount'] ?? null, 'expected' => $order['amount']]);
        return ['paid' => false, 'note' => 'paid amount ' . ($d['amount'] ?? '?') . ' does not match the order — review and confirm by hand']; // an admin can review and confirm by hand
    }
    return ['paid' => true, 'ref' => (string)($order['provider_ref'] ?? ''), 'raw' => $meta + ['check' => $res]];
}

/** Callback signature from the docs: sha256(secret + req_time + transaction_id + amount + "SUCCESS"), amount as received. */
function anajakpay_callback_hash(string $secret, string $reqTime, string $tid, string $amount): string
{
    return hash('sha256', $secret . $reqTime . $tid . $amount . 'SUCCESS');
}

/**
 * Payment callback from AnajakPay. Two shapes:
 *  - server-to-server POST (JSON) to success_url or the Webhook URL set in AnajakPay Settings:
 *      { transaction_id, amount, status, req_time, hash }
 *  - the customer's browser redirected to success_url with ?success_hash&success_time&success_amount
 * An order is completed ONLY when the gateway's signature verifies, status is SUCCESS and the amount matches.
 * Our per-order token (?t=) is checked too when present (it is absent on the Settings webhook URL).
 */
function anajakpay_webhook(): void
{
    $c = anajakpay_cfg();
    $raw = substr((string)file_get_contents('php://input'), 0, 8000);
    $json = json_decode($raw, true);
    $in = is_array($json) ? $json : $_POST;
    $browser = stripos($_SERVER['HTTP_ACCEPT'] ?? '', 'text/html') !== false;

    $tid = (string)($in['transaction_id'] ?? $_GET['ref'] ?? '');
    $order = $tid !== '' ? row("SELECT * FROM orders WHERE ref = ? AND provider = 'anajakpay'", [$tid]) : null;
    $reject = function (string $why) use ($tid, $browser) {
        audit(null, 'anajakpay.callback.rejected', 'ref:' . substr($tid, 0, 20), ['why' => $why]);
        if ($browser) anajakpay_page(false);
        fail('Invalid callback', 403);
    };
    if (!$order) $reject('unknown order');
    if (isset($_GET['t']) && !hash_equals(anajakpay_callback_token($order['ref']), (string)$_GET['t'])) $reject('bad url token');

    // which signed fields did we get?
    if (isset($in['hash'])) {
        $amount = (string)($in['amount'] ?? '');
        $reqTime = (string)($in['req_time'] ?? '');
        $sig = (string)$in['hash'];
        $status = strtoupper((string)($in['status'] ?? ''));
    } elseif (isset($_GET['success_hash'])) {
        $amount = (string)($_GET['success_amount'] ?? '');
        $reqTime = (string)($_GET['success_time'] ?? '');
        $sig = (string)$_GET['success_hash'];
        $status = 'SUCCESS';
    } else {
        $reject('no signature');
    }
    if (!hash_equals(anajakpay_callback_hash($c['secret'], $reqTime, $order['ref'], $amount), strtolower($sig))) $reject('bad signature');
    if ($status !== 'SUCCESS') $reject("status $status");
    if (abs((float)$amount - (float)$order['amount']) > 0.005) $reject("amount $amount != {$order['amount']}");

    $payload = ['query' => array_diff_key($_GET, ['t' => 1, 'r' => 1]), 'body' => is_array($json) ? $json : $_POST];
    // a late payment after our 15-min QR window is still honoured
    q("UPDATE orders SET status = 'pending' WHERE id = ? AND status IN ('expired','canceled')", [$order['id']]);
    complete_order(row('SELECT * FROM orders WHERE id = ?', [$order['id']]), (string)($order['provider_ref'] ?? ''), $payload);
    if ($browser) anajakpay_page(true);
}

function anajakpay_page(bool $ok): never
{
    header('content-type: text/html; charset=utf-8');
    [$icon, $title, $text] = $ok
        ? ['✅', 'Payment received', 'Your KhmerDub Studio plan is active. You can go back to the app.']
        : ['⏳', 'Confirming your payment', 'If you paid, your plan turns on as soon as the payment is confirmed. You can go back to the app.'];
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' . $title . '</title>'
        . '<body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;text-align:center"><div><div style="font-size:56px">' . $icon . '</div>'
        . '<h2>' . $title . '</h2><p>' . $text . '</p></div>';
    exit;
}

<?php
// KhmerDub account API.  /api/<route>  (rewritten to index.php?r=<route> by .htaccess)
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';
require __DIR__ . '/../lib/payments.php';
require __DIR__ . '/../lib/keys.php';
require __DIR__ . '/../lib/social.php';

$method = $_SERVER['REQUEST_METHOD'];
$route = trim((string)($_GET['r'] ?? ''), '/');

const PW_MIN = 8;

function rand_code(int $n): string
{
    $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    $s = '';
    for ($i = 0; $i < $n; $i++) $s .= $alpha[random_int(0, strlen($alpha) - 1)];
    return $s;
}

function me_payload(array $u): array
{
    return ['user' => public_user($u), 'access' => access_of($u), 'serverTime' => now()];
}

function trial_days(): int
{
    return max(0, (int)setting('trial_days', (string)cfg('trial_days', 3)));
}

/** New session for a verified user: device limit (oldest signed out) + audit. */
function login_session(array $u, string $device, string $via = 'email'): string
{
    $max = max(1, (int)setting('max_devices', '2'));
    $token = new_session((int)$u['id'], $device);
    $ids = array_column(q('SELECT id FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', [$u['id'], now()])->fetchAll(), 'id');
    if (count($ids) > $max) q('DELETE FROM sessions WHERE id IN (' . implode(',', array_map('intval', array_slice($ids, $max))) . ')');
    audit((int)$u['id'], 'user.login', 'user:' . $u['id'], ['via' => $via]);
    return $token;
}

try {
    social_migrate();
    switch ("$method $route") {
        // ───────── public ─────────
        case 'GET health':
            db();
            json_out(['ok' => true, 'name' => cfg('app_name', 'KhmerDub Studio'), 'time' => now(), 'payment' => payment_mode(), 'trialDays' => trial_days(), 'auth' => auth_methods()]);

        case 'GET plans':
            $rows = q('SELECT * FROM plans WHERE enabled = 1 ORDER BY sort, id')->fetchAll();
            json_out(['plans' => array_map('public_plan', $rows), 'currency' => setting('currency', 'USD'), 'payment' => payment_mode(), 'support' => setting('support_contact', ''), 'trialDays' => trial_days(), 'auth' => auth_methods()]);

        // ───────── auth ─────────
        case 'POST auth/register':
            if (setting('registration_open', '1') !== '1') fail('Sign-up is closed. Contact the admin.', 403);
            $email = mb_strtolower(str_in('email', 190));
            $pw = (string)(body()['password'] ?? '');
            $name = str_in('name', 80, false);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address');
            if (strlen($pw) < PW_MIN) fail('Password must be at least ' . PW_MIN . ' characters');
            if (row('SELECT id FROM users WHERE email = ?', [$email])) fail('This email already has an account — sign in instead', 409);
            $trialEnd = trial_days() > 0 ? gmdate('Y-m-d H:i:s', time() + trial_days() * 86400) : null;
            q("INSERT INTO users (email, name, password_hash, role, status, trial_ends_at, created_at) VALUES (?,?,?,'user','active',?,?)", [
                $email, $name ?: explode('@', $email)[0], password_hash($pw, PASSWORD_DEFAULT), $trialEnd, now()
            ]);
            $id = (int)db()->lastInsertId();
            audit($id, 'user.register', "user:$id");
            $u = row('SELECT * FROM users WHERE id = ?', [$id]);
            json_out(['token' => new_session($id, str_in('device', 120, false))] + me_payload($u), 201);

        case 'POST auth/login':
            $email = mb_strtolower(str_in('email', 190));
            check_throttle($email);
            $u = row('SELECT * FROM users WHERE email = ?', [$email]);
            if ($u && $u['password_hash'] === '') fail('This account signs in with ' . ($u['auth_provider'] === 'telegram' ? 'Telegram' : 'Google') . ' — use that button above.', 401);
            if (!$u || !password_verify((string)(body()['password'] ?? ''), $u['password_hash'])) {
                q('INSERT INTO login_failures (email, ip, at) VALUES (?,?,?)', [$email, client_ip(), now()]);
                fail('Wrong email or password', 401);
            }
            if ($u['status'] !== 'active') fail('This account is disabled. Contact support.', 403);
            if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)body()['password'], PASSWORD_DEFAULT), $u['id']]);
            // device limit: oldest sessions are signed out
            $token = login_session($u, str_in('device', 120, false));
            json_out(['token' => $token] + me_payload($u));

        // ───────── Google / Telegram (browser hand-off, see lib/social.php) ─────────
        case 'GET auth/methods':
            json_out(auth_methods());

        case 'POST auth/ext/start':
            json_out(ticket_start(str_in('provider', 10)));

        case 'POST auth/ext/poll':
            $r = ticket_poll(str_in('state', 64), str_in('device', 120, false));
            if (!empty($r['pending'])) json_out(['pending' => true]);
            json_out(['token' => $r['token']] + me_payload($r['user']));

        case 'GET auth/web':
            auth_web();

        case 'GET auth/google/callback':
            google_callback();

        case 'GET auth/telegram/callback':
            telegram_callback();

        case 'POST auth/logout':
            $u = auth_user();
            q('DELETE FROM sessions WHERE id = ?', [$u['_session']]);
            json_out(['ok' => true]);

        case 'POST auth/password':
            $u = auth_user();
            if ($u['password_hash'] !== '' && !password_verify((string)(body()['current'] ?? ''), $u['password_hash'])) fail('Current password is wrong', 401);
            if (str_ends_with($u['email'], '@telegram.local')) fail('Telegram accounts sign in with Telegram — there is no email to use with a password.');
            $pw = (string)(body()['password'] ?? '');
            if (strlen($pw) < PW_MIN) fail('Password must be at least ' . PW_MIN . ' characters');
            q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
            q('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [$u['id'], $u['_session']]);
            json_out(['ok' => true]);

        // ───────── account ─────────
        case 'GET me':
            json_out(me_payload(auth_user()));

        case 'POST me':
            $u = auth_user();
            $name = str_in('name', 80);
            q('UPDATE users SET name = ? WHERE id = ?', [$name, $u['id']]);
            json_out(me_payload(row('SELECT * FROM users WHERE id = ?', [$u['id']])));

        case 'GET me/history':
            $u = auth_user();
            $subs = q('SELECT s.starts_at, s.ends_at, s.source, s.revoked, p.name plan FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 50', [$u['id']])->fetchAll();
            $orders = q('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50', [$u['id']])->fetchAll();
            json_out(['subscriptions' => $subs, 'orders' => array_map('public_order', $orders)]);

        case 'POST redeem':
            $u = auth_user();
            check_throttle('redeem:' . $u['id']);
            $code = strtoupper(preg_replace('/[^A-Za-z0-9-]/', '', str_in('code', 40)));
            $c = row('SELECT * FROM license_codes WHERE code = ?', [$code]);
            if (!$c || $c['redeemed_by'] || $c['revoked']) {
                q('INSERT INTO login_failures (email, ip, at) VALUES (?,?,?)', ['redeem:' . $u['id'], client_ip(), now()]);
                fail('This code is not valid or was already used', 404);
            }
            $st = q('UPDATE license_codes SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_by IS NULL', [$u['id'], now(), $c['id']]);
            if ($st->rowCount() !== 1) fail('This code was already used', 409);
            $plan = plan_by_id((int)$c['plan_id']);
            grant_plan((int)$u['id'], $plan, 'code', null, $code);
            audit((int)$u['id'], 'code.redeem', "code:$code");
            json_out(['ok' => true, 'plan' => $plan['name']] + me_payload($u));

        // ───────── payments ─────────
        case 'POST pay/create':
            $u = auth_user();
            $plan = plan_by_id((int)(body()['planId'] ?? 0));
            if (!$plan || !$plan['enabled']) fail('Unknown plan');
            if ($plan['months'] === null && access_of($u)['kind'] === 'lifetime') fail('You already have lifetime access');
            $currency = setting('currency', 'USD') === 'KHR' ? 'KHR' : 'USD';
            $amount = $currency === 'KHR' ? (float)$plan['price_khr'] : (float)$plan['price_usd'];
            if ($amount <= 0) fail('This plan has no price set');
            // reuse an open order for the same plan instead of piling up QR codes
            $open = row("SELECT * FROM orders WHERE user_id = ? AND plan_id = ? AND status = 'pending' AND expires_at > ? AND provider = ? ORDER BY id DESC LIMIT 1", [$u['id'], $plan['id'], now(), payment_mode()]);
            if ($open) json_out(['order' => public_order($open), 'instructions' => setting('manual_instructions', '')]);
            $ref = 'KD' . rand_code(8);
            q("INSERT INTO orders (ref, user_id, plan_id, amount, currency, status, provider, expires_at, created_at) VALUES (?,?,?,?,?,'pending',?,?,?)", [
                $ref, $u['id'], $plan['id'], $amount, $currency, payment_mode(), gmdate('Y-m-d H:i:s', time() + 3600), now()
            ]);
            $id = (int)db()->lastInsertId();
            $order = row('SELECT * FROM orders WHERE id = ?', [$id]);
            $p = payment_create($order, $plan);
            q('UPDATE orders SET qr_string = ?, qr_image = ?, pay_url = ?, provider_ref = ?, expires_at = ? WHERE id = ?', [
                $p['qr_string'], $p['qr_image'], $p['pay_url'], $p['provider_ref'], $p['expires_at'], $id
            ]);
            audit((int)$u['id'], 'order.create', "order:$id", ['plan' => $plan['code'], 'amount' => $amount, 'currency' => $currency]);
            json_out(['order' => public_order(row('SELECT * FROM orders WHERE id = ?', [$id])), 'instructions' => setting('manual_instructions', '')], 201);

        case 'GET pay/status':
            $u = auth_user();
            $o = row('SELECT * FROM orders WHERE id = ? AND user_id = ?', [(int)($_GET['id'] ?? 0), $u['id']]);
            if (!$o) fail('Order not found', 404);
            $status = payment_check($o);
            json_out(['status' => $status, 'order' => public_order(row('SELECT * FROM orders WHERE id = ?', [$o['id']]))] + me_payload($u));

        case 'POST pay/cancel':
            $u = auth_user();
            q("UPDATE orders SET status = 'canceled' WHERE id = ? AND user_id = ? AND status = 'pending'", [(int)(body()['id'] ?? 0), $u['id']]);
            json_out(['ok' => true]);

        case 'GET pay/webhook/anajakpay':
        case 'POST pay/webhook/anajakpay':
            anajakpay_webhook();
            json_out(['ok' => true]);

        // ───────── API keys (encrypted on the server) ─────────
        case 'GET keys':
            // shared keys only reach accounts whose trial / plan is active; a user's own keys always follow them
            $u = auth_user();
            ensure_keys_table();
            $out = function (array $rows): array {
                $list = [];
                foreach ($rows as $r) {
                    $k = key_decrypt($r['key_enc']);
                    if ($k !== null) $list[] = ['id' => (int)$r['id'], 'provider' => $r['provider'], 'label' => $r['label'], 'key' => $k];
                }
                return $list;
            };
            $shared = access_of($u)['active']
                ? $out(q('SELECT * FROM api_keys WHERE user_id IS NULL AND enabled = 1 ORDER BY id')->fetchAll())
                : [];
            json_out(['shared' => $shared, 'mine' => $out(q('SELECT * FROM api_keys WHERE user_id = ? ORDER BY id', [$u['id']])->fetchAll())]);

        case 'POST keys/add':
            $u = auth_user();
            $p = str_in('provider', 20);
            $id = key_add((int)$u['id'], $p, key_clean($p, str_in('key', 400)), str_in('label', 80, false));
            json_out(['id' => $id], 201);

        case 'POST keys/remove':
            $u = auth_user();
            ensure_keys_table();
            q('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [(int)(body()['id'] ?? 0), $u['id']]);
            json_out(['ok' => true]);

        // ───────── admin ─────────
        case 'GET admin/stats':
            admin_user();
            $t = now();
            json_out([
                'users' => (int)row('SELECT COUNT(*) n FROM users')['n'],
                'newUsers7d' => (int)row('SELECT COUNT(*) n FROM users WHERE created_at > ?', [gmdate('Y-m-d H:i:s', time() - 7 * 86400)])['n'],
                'paying' => (int)row('SELECT COUNT(DISTINCT user_id) n FROM subscriptions WHERE revoked = 0 AND (ends_at IS NULL OR ends_at > ?)', [$t])['n'],
                'lifetime' => (int)row('SELECT COUNT(DISTINCT user_id) n FROM subscriptions WHERE revoked = 0 AND ends_at IS NULL')['n'],
                'trials' => (int)row('SELECT COUNT(*) n FROM users WHERE trial_ends_at > ?', [$t])['n'],
                'pendingOrders' => (int)row("SELECT COUNT(*) n FROM orders WHERE status = 'pending' AND expires_at > ?", [$t])['n'],
                'revenue' => q("SELECT currency, SUM(amount) total, COUNT(*) n FROM orders WHERE status = 'paid' GROUP BY currency")->fetchAll(),
                'revenue30d' => q("SELECT currency, SUM(amount) total FROM orders WHERE status = 'paid' AND paid_at > ? GROUP BY currency", [gmdate('Y-m-d H:i:s', time() - 30 * 86400)])->fetchAll(),
                'byPlan' => q("SELECT p.name, COUNT(*) n FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.revoked = 0 AND (s.ends_at IS NULL OR s.ends_at > ?) GROUP BY p.id ORDER BY p.sort", [$t])->fetchAll(),
                // dashboard chart: paid orders per UTC day for the last 30 days (days with no sales are filled in by the console)
                'daily' => q("SELECT DATE(paid_at) day, currency, SUM(amount) total, COUNT(*) n FROM orders WHERE status = 'paid' AND paid_at > ? GROUP BY DATE(paid_at), currency ORDER BY day", [gmdate('Y-m-d 00:00:00', time() - 29 * 86400)])->fetchAll(),
                'newUsersDaily' => q('SELECT DATE(created_at) day, COUNT(*) n FROM users WHERE created_at > ? GROUP BY DATE(created_at)', [gmdate('Y-m-d 00:00:00', time() - 29 * 86400)])->fetchAll(),
                'orderStatus' => q('SELECT status, COUNT(*) n FROM orders GROUP BY status')->fetchAll(),
                'paidToday' => (int)row("SELECT COUNT(*) n FROM orders WHERE status = 'paid' AND paid_at >= ?", [gmdate('Y-m-d 00:00:00')])['n'],
                'recent' => array_map(fn($o) => public_order($o) + ['userId' => (int)$o['user_id'], 'email' => $o['email'], 'plan' => $o['plan_name']], q('SELECT o.*, u.email, p.name plan_name FROM orders o JOIN users u ON u.id = o.user_id JOIN plans p ON p.id = o.plan_id ORDER BY o.id DESC LIMIT 8')->fetchAll()),
                'paymentMode' => setting('payment_mode', 'manual'),
            ]);

        case 'GET admin/users':
            admin_user();
            $s = '%' . trim((string)($_GET['q'] ?? '')) . '%';
            $page = max(0, (int)($_GET['page'] ?? 0));
            $rows = q('SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 50 OFFSET ' . ($page * 50), [$s, $s])->fetchAll();
            $total = (int)row('SELECT COUNT(*) n FROM users WHERE email LIKE ? OR name LIKE ?', [$s, $s])['n'];
            json_out(['total' => $total, 'users' => array_map(fn($u) => public_user($u) + [
                'access' => access_of($u),
                'lastLoginAt' => $u['last_login_at'],
                'lastDevice' => $u['last_device'],
                'devices' => (int)row('SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND expires_at > ?', [$u['id'], now()])['n'],
            ], $rows)]);

        case 'GET admin/user':
            admin_user();
            $u = row('SELECT * FROM users WHERE id = ?', [(int)($_GET['id'] ?? 0)]);
            if (!$u) fail('User not found', 404);
            json_out([
                'user' => public_user($u) + ['access' => access_of($u), 'trialEndsAt' => $u['trial_ends_at'], 'lastLoginAt' => $u['last_login_at'], 'note' => $u['note']],
                'subscriptions' => q('SELECT s.id, s.starts_at, s.ends_at, s.source, s.revoked, s.note, p.name plan FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? ORDER BY s.id DESC', [$u['id']])->fetchAll(),
                'orders' => array_map('public_order', q('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 30', [$u['id']])->fetchAll()),
                'sessions' => q('SELECT id, device, ip, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', [$u['id'], now()])->fetchAll(),
            ]);

        case 'POST admin/user':
            $admin = admin_user();
            $id = (int)(body()['id'] ?? 0);
            $u = row('SELECT * FROM users WHERE id = ?', [$id]);
            if (!$u) fail('User not found', 404);
            $b = body();
            if (isset($b['name'])) q('UPDATE users SET name = ? WHERE id = ?', [mb_substr(trim((string)$b['name']), 0, 80), $id]);
            if (isset($b['note'])) q('UPDATE users SET note = ? WHERE id = ?', [mb_substr((string)$b['note'], 0, 1000), $id]);
            if (isset($b['status']) && in_array($b['status'], ['active', 'disabled'], true)) {
                if ($id === (int)$admin['id'] && $b['status'] === 'disabled') fail('You cannot disable your own account');
                q('UPDATE users SET status = ? WHERE id = ?', [$b['status'], $id]);
                if ($b['status'] === 'disabled') q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            }
            if (isset($b['role']) && in_array($b['role'], ['user', 'admin'], true)) {
                if ($id === (int)$admin['id'] && $b['role'] !== 'admin') fail('You cannot remove your own admin role');
                q('UPDATE users SET role = ? WHERE id = ?', [$b['role'], $id]);
            }
            if (array_key_exists('trialDays', $b)) {
                $d = (int)$b['trialDays'];
                q('UPDATE users SET trial_ends_at = ? WHERE id = ?', [$d > 0 ? gmdate('Y-m-d H:i:s', time() + $d * 86400) : now(), $id]);
            }
            if (!empty($b['password'])) {
                if (strlen((string)$b['password']) < PW_MIN) fail('Password must be at least ' . PW_MIN . ' characters');
                q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash((string)$b['password'], PASSWORD_DEFAULT), $id]);
                q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            }
            if (!empty($b['signOut'])) q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            audit((int)$admin['id'], 'admin.user.update', "user:$id", array_diff_key($b, ['password' => 1]));
            json_out(['ok' => true]);

        case 'POST admin/user/create':
            $admin = admin_user();
            $email = mb_strtolower(str_in('email', 190));
            $pw = (string)(body()['password'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address');
            if (strlen($pw) < PW_MIN) fail('Password must be at least ' . PW_MIN . ' characters');
            if (row('SELECT id FROM users WHERE email = ?', [$email])) fail('Email already exists', 409);
            $role = (body()['role'] ?? 'user') === 'admin' ? 'admin' : 'user';
            q("INSERT INTO users (email, name, password_hash, role, status, trial_ends_at, created_at) VALUES (?,?,?,?,'active',?,?)", [
                $email, str_in('name', 80, false) ?: explode('@', $email)[0], password_hash($pw, PASSWORD_DEFAULT), $role,
                trial_days() > 0 ? gmdate('Y-m-d H:i:s', time() + trial_days() * 86400) : null, now()
            ]);
            $id = (int)db()->lastInsertId();
            audit((int)$admin['id'], 'admin.user.create', "user:$id", ['email' => $email, 'role' => $role]);
            json_out(['id' => $id], 201);

        case 'POST admin/grant':
            $admin = admin_user();
            $uid = (int)(body()['userId'] ?? 0);
            if (!row('SELECT id FROM users WHERE id = ?', [$uid])) fail('User not found', 404);
            $plan = plan_by_id((int)(body()['planId'] ?? 0));
            if (!$plan) fail('Unknown plan');
            $r = grant_plan($uid, $plan, 'admin', null, str_in('note', 250, false));
            audit((int)$admin['id'], 'admin.grant', "user:$uid", ['plan' => $plan['code']] + $r);
            json_out(['ok' => true] + $r);

        case 'POST admin/revoke':
            $admin = admin_user();
            $sid = (int)(body()['subscriptionId'] ?? 0);
            q('UPDATE subscriptions SET revoked = 1 WHERE id = ?', [$sid]);
            audit((int)$admin['id'], 'admin.revoke', "subscription:$sid");
            json_out(['ok' => true]);

        case 'GET admin/plans':
            admin_user();
            json_out(['plans' => array_map(fn($p) => public_plan($p) + ['sort' => (int)$p['sort']], q('SELECT * FROM plans ORDER BY sort, id')->fetchAll())]);

        case 'POST admin/plans':
            $admin = admin_user();
            foreach ((array)(body()['plans'] ?? []) as $p) {
                q('UPDATE plans SET name = ?, price_usd = ?, price_khr = ?, badge = ?, enabled = ?, sort = ? WHERE id = ?', [
                    mb_substr(trim((string)($p['name'] ?? '')), 0, 60), max(0, (float)($p['priceUsd'] ?? 0)), max(0, (int)($p['priceKhr'] ?? 0)),
                    mb_substr(trim((string)($p['badge'] ?? '')), 0, 30) ?: null, !empty($p['enabled']) ? 1 : 0, (int)($p['sort'] ?? 0), (int)($p['id'] ?? 0)
                ]);
            }
            audit((int)$admin['id'], 'admin.plans.update');
            json_out(['ok' => true]);

        case 'GET admin/orders':
            admin_user();
            $status = (string)($_GET['status'] ?? '');
            $where = in_array($status, ['pending', 'paid', 'expired', 'canceled', 'failed'], true) ? 'WHERE o.status = ?' : '';
            $rows = q("SELECT o.*, u.email, p.name plan FROM orders o JOIN users u ON u.id = o.user_id JOIN plans p ON p.id = o.plan_id $where ORDER BY o.id DESC LIMIT 200", $where ? [$status] : [])->fetchAll();
            json_out(['orders' => array_map(fn($o) => public_order($o) + ['email' => $o['email'], 'plan' => $o['plan'], 'userId' => (int)$o['user_id']], $rows)]);

        case 'POST admin/orders/confirm':
            $admin = admin_user();
            $o = row('SELECT * FROM orders WHERE id = ?', [(int)(body()['id'] ?? 0)]);
            if (!$o) fail('Order not found', 404);
            if ($o['status'] === 'paid') fail('Already paid');
            // an expired manual order can still be confirmed (the customer paid late)
            q("UPDATE orders SET status = 'pending' WHERE id = ? AND status IN ('expired','canceled')", [$o['id']]);
            complete_order(row('SELECT * FROM orders WHERE id = ?', [$o['id']]), str_in('ref', 120, false));
            audit((int)$admin['id'], 'admin.order.confirm', 'order:' . $o['id']);
            json_out(['ok' => true]);

        case 'POST admin/orders/reject':
            $admin = admin_user();
            $id = (int)(body()['id'] ?? 0);
            q("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'", [$id]);
            audit((int)$admin['id'], 'admin.order.reject', "order:$id");
            json_out(['ok' => true]);

        case 'GET admin/codes':
            admin_user();
            json_out(['codes' => q('SELECT c.id, c.code, c.note, c.revoked, c.created_at, c.redeemed_at, p.name plan, u.email redeemed_by FROM license_codes c JOIN plans p ON p.id = c.plan_id LEFT JOIN users u ON u.id = c.redeemed_by ORDER BY c.id DESC LIMIT 500')->fetchAll()]);

        case 'POST admin/codes':
            $admin = admin_user();
            $plan = plan_by_id((int)(body()['planId'] ?? 0));
            if (!$plan) fail('Unknown plan');
            $n = max(1, min(200, (int)(body()['count'] ?? 1)));
            $note = str_in('note', 120, false);
            $prefix = 'KD-' . strtoupper($plan['code']) . '-';
            $codes = [];
            for ($i = 0; $i < $n; $i++) {
                $code = $prefix . rand_code(4) . '-' . rand_code(4);
                q('INSERT INTO license_codes (code, plan_id, note, created_by, created_at) VALUES (?,?,?,?,?)', [$code, $plan['id'], $note ?: null, $admin['id'], now()]);
                $codes[] = $code;
            }
            audit((int)$admin['id'], 'admin.codes.create', 'plan:' . $plan['code'], ['count' => $n]);
            json_out(['codes' => $codes], 201);

        case 'POST admin/codes/revoke':
            $admin = admin_user();
            q('UPDATE license_codes SET revoked = 1 WHERE id = ? AND redeemed_by IS NULL', [(int)(body()['id'] ?? 0)]);
            audit((int)$admin['id'], 'admin.codes.revoke', 'code:' . (int)(body()['id'] ?? 0));
            json_out(['ok' => true]);

        case 'GET admin/settings':
            admin_user();
            $keys = ['trial_days', 'currency', 'payment_mode', 'anajakpay_flow', 'registration_open', 'max_devices', 'manual_qr_image', 'manual_instructions', 'support_contact'];
            $out = [];
            foreach ($keys as $k) $out[$k] = setting($k, '');
            $ap = anajakpay_creds();
            $out['anajakpay_configured'] = anajakpay_ready();
            $g = google_creds();
            $tg = telegram_creds();
            $host = parse_url(api_base(), PHP_URL_HOST);
            $out['signin'] = [
                'googleClientId' => $g['id'],
                'googleSecretSet' => $g['secret'] !== '',
                'googleRedirect' => google_redirect_uri(),
                'googleOrigin' => 'https://' . $host,
                'telegramBot' => $tg['bot'],
                'telegramTokenSet' => $tg['token'] !== '',
                'telegramDomain' => $host,
                'methods' => auth_methods(),
            ];
            // never send the secret — only whether it is set and its last 4 characters
            $out['anajakpay'] = [
                'apiKey' => (string)($ap['api_key'] ?? ''),
                'secretSet' => !empty($ap['secret']),
                'secretHint' => !empty($ap['secret']) ? '…' . substr((string)$ap['secret'], -4) : '',
                'secretFrom' => setting('anajakpay_secret', '') !== '' ? 'admin' : (!empty(cfg('anajakpay', [])['secret']) ? 'config.php' : ''),
                'publicUrl' => (string)setting('anajakpay_public_url', ''),
                'configPublicUrl' => (string)(cfg('anajakpay', [])['public_api_url'] ?? ''),
                'webhookUrl' => anajakpay_webhook_url(),
                'blockedFor' => anajakpay_blocked(),
            ];
            json_out($out);

        case 'POST admin/settings':
            $admin = admin_user();
            $b = body();
            $allowed = [
                'trial_days' => fn($v) => (string)max(0, min(365, (int)$v)),
                'currency' => fn($v) => $v === 'KHR' ? 'KHR' : 'USD',
                'payment_mode' => fn($v) => $v === 'anajakpay' ? 'anajakpay' : 'manual',
                'registration_open' => fn($v) => $v ? '1' : '0',
                'max_devices' => fn($v) => (string)max(1, min(20, (int)$v)),
                'manual_qr_image' => function ($v) {
                    $v = (string)$v;
                    if ($v !== '' && !preg_match('#^(data:image/(png|jpeg|webp);base64,|https://)#', $v)) fail('QR image must be an uploaded image or an https:// URL');
                    if (strlen($v) > 2_000_000) fail('QR image is too large (max ~1.5 MB)');
                    return $v;
                },
                'manual_instructions' => fn($v) => mb_substr((string)$v, 0, 1000),
                'support_contact' => fn($v) => mb_substr((string)$v, 0, 200),
                'anajakpay_flow' => fn($v) => $v === 'checkout' ? 'checkout' : 'qr',
                'anajakpay_api_key' => function ($v) {
                    $v = trim((string)$v);
                    if ($v !== '' && !preg_match('/^[A-Za-z0-9_-]{8,128}$/', $v)) fail('AnajakPay profile ID: letters and digits only (the code in your AnajakPay API URLs)');
                    return $v;
                },
                // write-only: an empty value keeps the current secret; 'anajakpay_secret_clear' removes it
                'anajakpay_secret' => function ($v) {
                    $v = trim((string)$v);
                    if (strlen($v) > 200 || preg_match('/\s/', $v)) fail('AnajakPay secret key looks wrong');
                    return $v;
                },
                'anajakpay_public_url' => function ($v) {
                    $v = trim((string)$v);
                    if ($v !== '' && !preg_match('#^https?://[^\s]+$#i', $v)) fail('Public API URL must start with https://');
                    return $v === '' ? '' : rtrim($v, '/') . '/';
                },
            ];
            if (($b['anajakpay_secret'] ?? '') === '') unset($b['anajakpay_secret']);
            // sign-in methods (secrets are write-only and stored encrypted; empty = keep)
            if (array_key_exists('google_client_id', $b)) {
                $v = trim((string)$b['google_client_id']);
                if ($v !== '' && !preg_match('/^[\w.-]+\.apps\.googleusercontent\.com$/', $v)) fail('Google client ID ends with .apps.googleusercontent.com');
                set_setting('google_client_id', $v);
            }
            if (trim((string)($b['google_client_secret'] ?? '')) !== '') set_setting('google_client_secret', key_encrypt(trim((string)$b['google_client_secret'])));
            if (!empty($b['google_clear'])) {
                set_setting('google_client_id', '');
                set_setting('google_client_secret', '');
            }
            if (array_key_exists('telegram_bot_username', $b)) {
                $v = ltrim(trim((string)$b['telegram_bot_username']), '@');
                if ($v !== '' && !preg_match('/^\w{5,32}$/', $v)) fail('Telegram bot username looks wrong (e.g. KhmerDubBot)');
                set_setting('telegram_bot_username', $v);
            }
            if (trim((string)($b['telegram_bot_token'] ?? '')) !== '') {
                $v = trim((string)$b['telegram_bot_token']);
                if (!preg_match('/^\d+:[\w-]{30,}$/', $v)) fail('Telegram bot token looks wrong (from @BotFather, like 123456:ABC…)');
                set_setting('telegram_bot_token', key_encrypt($v));
            }
            if (!empty($b['telegram_clear'])) {
                set_setting('telegram_bot_username', '');
                set_setting('telegram_bot_token', '');
            }
            if (!empty($b['anajakpay_secret_clear'])) set_setting('anajakpay_secret', '');
            foreach ($allowed as $k => $clean) if (array_key_exists($k, $b)) set_setting($k, $clean($b[$k]));
            $logged = array_diff_key($b, ['manual_qr_image' => 1, 'anajakpay_secret' => 1, 'google_client_secret' => 1, 'telegram_bot_token' => 1]);
            if (isset($b['anajakpay_secret'])) $logged['anajakpay_secret'] = '(changed)';
            audit((int)$admin['id'], 'admin.settings', '', $logged);
            json_out(['ok' => true]);

        case 'POST admin/anajakpay/test':
            $admin = admin_user();
            $r = anajakpay_test();
            audit((int)$admin['id'], 'admin.anajakpay.test', '', ['ok' => $r['ok']]);
            json_out($r);

        case 'POST admin/orders/check':
            admin_user();
            $o = row('SELECT * FROM orders WHERE id = ?', [(int)(body()['id'] ?? 0)]);
            if (!$o) fail('Order not found', 404);
            if ($o['provider'] !== 'anajakpay') fail('Only AnajakPay orders can be checked automatically');
            $note = null;
            $status = payment_check($o, true, $note);
            json_out(['status' => $status, 'note' => $note]);

        case 'GET admin/keys':
            admin_user();
            ensure_keys_table();
            $rows = q('SELECT id, provider, label, key_enc, enabled, created_at FROM api_keys WHERE user_id IS NULL ORDER BY provider, id')->fetchAll();
            $personal = q('SELECT provider, COUNT(*) c, COUNT(DISTINCT user_id) users FROM api_keys WHERE user_id IS NOT NULL GROUP BY provider')->fetchAll();
            json_out([
                'keys' => array_map(fn($r) => ['id' => (int)$r['id'], 'provider' => $r['provider'], 'label' => $r['label'], 'masked' => key_mask(key_decrypt($r['key_enc']) ?? ''), 'enabled' => (bool)$r['enabled'], 'created_at' => $r['created_at']], $rows),
                'personal' => $personal,
                'providers' => KEY_PROVIDERS,
            ]);

        case 'POST admin/keys':
            $a = admin_user();
            $p = str_in('provider', 20);
            // several keys can be pasted at once, one per line
            $lines = array_filter(array_map('trim', preg_split('/\R/',(string)(body()['key'] ?? ''))));
            if (!$lines) fail('Paste at least one key');
            if (count($lines) > 100) fail('Too many keys at once (max 100)');
            $n = 0;
            foreach ($lines as $k) { key_add(null, $p, key_clean($p, $k), str_in('label', 80, false)); $n++; }
            audit((int)$a['id'], 'keys.add', "provider:$p", ['count' => $n]);
            json_out(['added' => $n], 201);

        case 'POST admin/keys/toggle':
            $a = admin_user();
            ensure_keys_table();
            q('UPDATE api_keys SET enabled = ? WHERE id = ? AND user_id IS NULL', [!empty(body()['enabled']) ? 1 : 0, (int)(body()['id'] ?? 0)]);
            audit((int)$a['id'], 'keys.toggle', 'key:' . (int)(body()['id'] ?? 0));
            json_out(['ok' => true]);

        case 'POST admin/keys/remove':
            $a = admin_user();
            ensure_keys_table();
            q('DELETE FROM api_keys WHERE id = ? AND user_id IS NULL', [(int)(body()['id'] ?? 0)]);
            audit((int)$a['id'], 'keys.remove', 'key:' . (int)(body()['id'] ?? 0));
            json_out(['ok' => true]);

        case 'GET admin/audit':
            admin_user();
            json_out(['log' => q('SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300')->fetchAll()]);

        default:
            fail("Unknown endpoint: $method /$route", 404);
    }
} catch (ApiError $e) {
    json_out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('[khmerdub] ' . $e);
    json_out(['error' => cfg('debug') ? $e->getMessage() : 'Server error'], 500);
}

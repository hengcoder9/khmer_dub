<?php
// Sign in with Google / Telegram for the desktop app (browser hand-off, like a device-code flow):
//   1. app   POST auth/ext/start {provider}  → { state, url }   (state = 32 random bytes, known only to the app)
//   2. app opens url in the browser: auth/web?state=… → Google consent, or a page with the Telegram Login button
//   3. Google / Telegram → auth/google/callback | auth/telegram/callback → verified → ticket marked done (user_id)
//   4. app   POST auth/ext/poll {state}      → { token, user, access } once, then the ticket is deleted
declare(strict_types=1);

const TICKET_MINUTES = 10;

/** Columns + table for social sign-in; runs once per server (schema_v in settings). */
function social_migrate(): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    if ((int)setting('schema_v', '1') >= 2) return;
    $cols = array_column(q('SHOW COLUMNS FROM users')->fetchAll(), 'Field');
    $add = [];
    if (!in_array('google_sub', $cols, true)) $add[] = 'ADD google_sub VARCHAR(64) NULL UNIQUE';
    if (!in_array('telegram_id', $cols, true)) $add[] = 'ADD telegram_id BIGINT NULL UNIQUE';
    if (!in_array('telegram_username', $cols, true)) $add[] = 'ADD telegram_username VARCHAR(64) NULL';
    if (!in_array('avatar_url', $cols, true)) $add[] = 'ADD avatar_url VARCHAR(500) NULL';
    if (!in_array('auth_provider', $cols, true)) $add[] = "ADD auth_provider VARCHAR(10) NOT NULL DEFAULT 'email'";
    if ($add) db()->exec('ALTER TABLE users ' . implode(', ', $add));
    db()->exec("CREATE TABLE IF NOT EXISTS auth_tickets (
      state_hash CHAR(64) PRIMARY KEY,
      provider VARCHAR(10) NOT NULL,
      user_id INT UNSIGNED NULL,
      error VARCHAR(300) NULL,
      created_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    set_setting('schema_v', '2');
}

/** Public address of this API (…/api/), for OAuth redirect URIs. */
function api_base(): string
{
    $c = (string)(cfg('anajakpay', [])['public_api_url'] ?? '');
    if ($c) return rtrim($c, '/') . '/';
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'), '/') . '/';
}

function google_redirect_uri(): string
{
    return api_base() . 'auth/google/callback';
}

/** Secret settings are stored encrypted (same AES-GCM master key as the API keys). */
function secret_setting(string $k): string
{
    $v = (string)setting($k, '');
    return $v === '' ? '' : (key_decrypt($v) ?? '');
}

function google_creds(): array
{
    return ['id' => trim((string)setting('google_client_id', '')), 'secret' => secret_setting('google_client_secret')];
}

function telegram_creds(): array
{
    return ['bot' => ltrim(trim((string)setting('telegram_bot_username', '')), '@'), 'token' => secret_setting('telegram_bot_token')];
}

function auth_methods(): array
{
    $g = google_creds();
    $t = telegram_creds();
    return ['email' => true, 'google' => $g['id'] !== '' && $g['secret'] !== '', 'telegram' => $t['bot'] !== '' && $t['token'] !== ''];
}

function ticket(string $state): ?array
{
    if (!preg_match('/^[a-f0-9]{64}$/', $state)) return null;
    return row('SELECT * FROM auth_tickets WHERE state_hash = ? AND expires_at > ?', [hash('sha256', $state), now()]);
}

function ticket_start(string $provider): array
{
    if (!in_array($provider, ['google', 'telegram'], true)) fail('Unknown sign-in method');
    if (!auth_methods()[$provider]) fail(($provider === 'google' ? 'Google' : 'Telegram') . ' sign-in is not set up yet. The admin adds it in Admin → Settings → Sign-in methods.', 503);
    q('DELETE FROM auth_tickets WHERE expires_at < ?', [now()]);
    $state = bin2hex(random_bytes(32));
    q('INSERT INTO auth_tickets (state_hash, provider, created_at, expires_at) VALUES (?,?,?,?)', [hash('sha256', $state), $provider, now(), gmdate('Y-m-d H:i:s', time() + TICKET_MINUTES * 60)]);
    return ['state' => $state, 'url' => api_base() . 'auth/web?state=' . $state, 'expiresIn' => TICKET_MINUTES * 60];
}

function ticket_finish(string $state, ?int $userId, ?string $error = null): void
{
    q('UPDATE auth_tickets SET user_id = ?, error = ? WHERE state_hash = ?', [$userId, $error ? mb_substr($error, 0, 300) : null, hash('sha256', $state)]);
}

/** Small branded page in the browser. */
function auth_page(string $title, string $body, bool $ok = true): never
{
    header('content-type: text/html; charset=utf-8');
    header('cache-control: no-store');
    header("content-security-policy: default-src 'self'; script-src https://telegram.org 'unsafe-inline'; frame-src https://oauth.telegram.org; img-src * data:; style-src 'unsafe-inline'");
    $icon = $ok ? '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>'
        : '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
    echo '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . htmlspecialchars(strip_tags($title)) . ' · KhmerDub Studio</title>'
        . '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,sans-serif;background:#0f1115;color:#e5e7eb}'
        . '.c{width:min(420px,calc(100vw - 32px));padding:36px 28px;border:1px solid #262a33;border-radius:20px;background:#16181d;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4)}'
        . '.b{display:inline-flex;align-items:center;gap:8px;margin-bottom:20px;font-weight:700;letter-spacing:.2px}.b i{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#8b5cf6,#60a5fa)}'
        . 'h1{font-size:20px;margin:14px 0 8px}p{color:#9ca3af;font-size:14px;line-height:1.55;margin:0}.w{margin-top:22px;display:flex;justify-content:center;min-height:48px}</style></head>'
        . '<body><div class="c"><div class="b"><i></i>KhmerDub Studio</div><div>' . $icon . '</div><h1>' . $title . '</h1>' . $body . '</div></body></html>';
    exit;
}

/** Step 2: the browser page the app opened. */
function auth_web(): never
{
    $state = (string)($_GET['state'] ?? '');
    $t = ticket($state);
    if (!$t || $t['user_id'] || $t['error']) auth_page('Link expired', '<p>This sign-in link was already used or is older than ' . TICKET_MINUTES . ' minutes. Go back to the app and try again.</p>', false);
    if ($t['provider'] === 'google') {
        $g = google_creds();
        header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
            'client_id' => $g['id'],
            'redirect_uri' => google_redirect_uri(),
            'response_type' => 'code',
            'scope' => 'openid email profile',
            'state' => $state,
            'prompt' => 'select_account',
        ]));
        exit;
    }
    $bot = htmlspecialchars(telegram_creds()['bot']);
    $cb = htmlspecialchars(api_base() . 'auth/telegram/callback?state=' . $state);
    header('content-type: text/html; charset=utf-8');
    auth_page(
        'Sign in with Telegram',
        '<p>Tap the button and confirm in Telegram. You will come back to the app automatically.</p>'
            . '<div class="w"><script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="' . $bot . '" data-size="large" data-radius="12" data-auth-url="' . $cb . '" data-request-access="write"></script></div>'
    );
}

function http_post_form(string $url, array $data): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($data), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
    $txt = (string)curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($txt, true) ?: []];
}

function http_get_json(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
    $txt = (string)curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($txt, true) ?: []];
}

/** Find or create the account for a verified identity. */
function social_user(string $provider, array $id): array
{
    $u = $provider === 'google'
        ? row('SELECT * FROM users WHERE google_sub = ?', [$id['sub']])
        : row('SELECT * FROM users WHERE telegram_id = ?', [$id['tid']]);
    // Google: same verified email as an existing (email/password) account → link it
    if (!$u && $provider === 'google' && $id['email'] !== '') {
        $u = row('SELECT * FROM users WHERE email = ?', [$id['email']]);
        if ($u) q('UPDATE users SET google_sub = ? WHERE id = ?', [$id['sub'], $u['id']]);
    }
    if ($u) {
        // keep the picture / username fresh
        if ($provider === 'google') q('UPDATE users SET avatar_url = COALESCE(?, avatar_url) WHERE id = ?', [$id['picture'] ?: null, $u['id']]);
        else q('UPDATE users SET telegram_username = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?', [$id['username'] ?: null, $id['picture'] ?: null, $u['id']]);
        return row('SELECT * FROM users WHERE id = ?', [$u['id']]);
    }
    if (setting('registration_open', '1') !== '1') throw new RuntimeException('Sign-up is closed. Contact the admin.');
    $trialEnd = trial_days() > 0 ? gmdate('Y-m-d H:i:s', time() + trial_days() * 86400) : null;
    // Telegram has no email: a unique placeholder that can never receive mail or sign in with a password
    $email = $provider === 'google' ? $id['email'] : 'tg' . $id['tid'] . '@telegram.local';
    q("INSERT INTO users (email, name, password_hash, role, status, trial_ends_at, created_at, google_sub, telegram_id, telegram_username, avatar_url, auth_provider) VALUES (?,?,'','user','active',?,?,?,?,?,?,?)", [
        $email, mb_substr($id['name'] ?: explode('@', $email)[0], 0, 80), $trialEnd, now(),
        $provider === 'google' ? $id['sub'] : null, $provider === 'telegram' ? $id['tid'] : null, $id['username'] ?? null, $id['picture'] ?: null, $provider,
    ]);
    $uid = (int)db()->lastInsertId();
    audit($uid, 'user.register', "user:$uid", ['via' => $provider]);
    return row('SELECT * FROM users WHERE id = ?', [$uid]);
}

function finish_with(string $state, string $provider, array $identity): never
{
    try {
        $u = social_user($provider, $identity);
        if ($u['status'] !== 'active') throw new RuntimeException('This account is disabled. Contact support.');
        ticket_finish($state, (int)$u['id']);
        auth_page("You're signed in", '<p>Welcome, <b>' . htmlspecialchars($u['name']) . '</b>! Go back to <b>KhmerDub Studio</b> — it has signed you in. You can close this tab.</p>');
    } catch (Throwable $e) {
        ticket_finish($state, null, $e->getMessage());
        auth_page('Sign-in failed', '<p>' . htmlspecialchars($e->getMessage()) . '</p>', false);
    }
}

/** Step 3a: Google sends the user back with ?code&state. */
function google_callback(): never
{
    $state = (string)($_GET['state'] ?? '');
    $t = ticket($state);
    if (!$t || $t['provider'] !== 'google' || $t['user_id']) auth_page('Link expired', '<p>Go back to the app and try again.</p>', false);
    if (!empty($_GET['error'])) {
        ticket_finish($state, null, 'Google sign-in was canceled');
        auth_page('Sign-in canceled', '<p>You can close this tab and try again in the app.</p>', false);
    }
    $g = google_creds();
    [$code, $tok] = http_post_form('https://oauth2.googleapis.com/token', [
        'code' => (string)($_GET['code'] ?? ''), 'client_id' => $g['id'], 'client_secret' => $g['secret'],
        'redirect_uri' => google_redirect_uri(), 'grant_type' => 'authorization_code',
    ]);
    if ($code !== 200 || empty($tok['id_token'])) {
        ticket_finish($state, null, 'Google did not accept the sign-in: ' . ($tok['error_description'] ?? $tok['error'] ?? "HTTP $code"));
        auth_page('Sign-in failed', '<p>Google did not accept the sign-in (' . htmlspecialchars((string)($tok['error'] ?? $code)) . '). Check the client ID / secret and redirect URI in Admin → Settings.</p>', false);
    }
    // the id_token came straight from Google over TLS; tokeninfo also checks signature + expiry
    [$c2, $info] = http_get_json('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($tok['id_token']));
    if ($c2 !== 200 || ($info['aud'] ?? '') !== $g['id'] || !in_array($info['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)) {
        ticket_finish($state, null, 'Google sign-in could not be verified');
        auth_page('Sign-in failed', '<p>Google sign-in could not be verified. Try again.</p>', false);
    }
    if (($info['email_verified'] ?? '') !== 'true' && ($info['email_verified'] ?? false) !== true) {
        ticket_finish($state, null, 'Your Google email is not verified');
        auth_page('Sign-in failed', '<p>Your Google email is not verified.</p>', false);
    }
    finish_with($state, 'google', ['sub' => (string)$info['sub'], 'email' => mb_strtolower((string)$info['email']), 'name' => (string)($info['name'] ?? ''), 'picture' => (string)($info['picture'] ?? '')]);
}

/** Telegram Login Widget data check (https://core.telegram.org/widgets/login#checking-authorization). */
function telegram_verify(array $q, string $botToken): bool
{
    $hash = (string)($q['hash'] ?? '');
    $fields = array_intersect_key($q, array_flip(['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date']));
    ksort($fields);
    $check = implode("\n", array_map(fn($k, $v) => "$k=$v", array_keys($fields), $fields));
    $calc = hash_hmac('sha256', $check, hash('sha256', $botToken, true));
    return $hash !== '' && hash_equals($calc, $hash) && time() - (int)($q['auth_date'] ?? 0) < 86400;
}

/** Step 3b: the Telegram widget redirects here with the signed user data. */
function telegram_callback(): never
{
    $state = (string)($_GET['state'] ?? '');
    $t = ticket($state);
    if (!$t || $t['provider'] !== 'telegram' || $t['user_id']) auth_page('Link expired', '<p>Go back to the app and try again.</p>', false);
    if (!telegram_verify($_GET, telegram_creds()['token'])) {
        ticket_finish($state, null, 'Telegram sign-in could not be verified');
        auth_page('Sign-in failed', '<p>Telegram sign-in could not be verified. Try again.</p>', false);
    }
    $name = trim(($_GET['first_name'] ?? '') . ' ' . ($_GET['last_name'] ?? ''));
    finish_with($state, 'telegram', ['tid' => (int)$_GET['id'], 'name' => $name, 'username' => (string)($_GET['username'] ?? ''), 'picture' => (string)($_GET['photo_url'] ?? '')]);
}

/** Step 4: the app collects its session. */
function ticket_poll(string $state, string $device): array
{
    $t = ticket($state);
    if (!$t) fail('Sign-in timed out — try again', 410);
    if ($t['error']) {
        q('DELETE FROM auth_tickets WHERE state_hash = ?', [$t['state_hash']]);
        fail((string)$t['error'], 400);
    }
    if (!$t['user_id']) return ['pending' => true];
    q('DELETE FROM auth_tickets WHERE state_hash = ?', [$t['state_hash']]);
    $u = row('SELECT * FROM users WHERE id = ?', [$t['user_id']]);
    if (!$u || $u['status'] !== 'active') fail('This account is disabled. Contact support.', 403);
    $token = login_session($u, $device, $t['provider']);
    return ['token' => $token, 'user' => $u];
}

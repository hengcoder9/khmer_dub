<?php
// API keys kept on the server, encrypted at rest (AES-256-GCM).
//   • shared keys  (user_id NULL)  — added by the admin, handed to every signed-in user with active access
//   • personal keys (user_id = n)  — a user's own keys, synced to their account for use on other PCs
declare(strict_types=1);

const KEY_PROVIDERS = ['gemini', 'openrouter', 'claude', 'codecraft'];
const KEYS_PER_USER = 30;

function ensure_keys_table(): void
{
    static $done = false;
    if ($done) return;
    db()->exec("CREATE TABLE IF NOT EXISTS api_keys (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NULL COMMENT 'NULL = shared by the admin',
      provider VARCHAR(20) NOT NULL,
      label VARCHAR(80) NOT NULL DEFAULT '',
      key_enc TEXT NOT NULL,
      key_hash CHAR(64) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      INDEX (user_id),
      INDEX (provider, enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $done = true;
}

/** 32-byte master key: config.php `keys_secret` if set, else one generated once and kept in the settings table. */
function keys_secret(): string
{
    $s = (string)cfg('keys_secret', '');
    if ($s === '') {
        $s = setting('keys_secret', '');
        if ($s === '') {
            $s = bin2hex(random_bytes(32));
            set_setting('keys_secret', $s);
        }
    }
    return hash('sha256', $s, true);
}

function key_encrypt(string $plain): string
{
    $iv = random_bytes(12);
    $ct = openssl_encrypt($plain, 'aes-256-gcm', keys_secret(), OPENSSL_RAW_DATA, $iv, $tag);
    if ($ct === false) throw new RuntimeException('Encryption failed');
    return base64_encode($iv . $tag . $ct);
}

function key_decrypt(string $enc): ?string
{
    $raw = base64_decode($enc, true);
    if ($raw === false || strlen($raw) < 29) return null;
    $p = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', keys_secret(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $p === false ? null : $p;
}

function key_mask(string $k): string
{
    return strlen($k) <= 10 ? '••••' : substr($k, 0, 4) . '…' . substr($k, -4);
}

function key_clean(string $provider, string $key): string
{
    if (!in_array($provider, KEY_PROVIDERS, true)) fail('Unknown provider');
    $key = trim($key);
    if ($key === '' || strlen($key) > 400 || preg_match('/\s/', $key)) fail('That key looks wrong');
    return $key;
}

/** Insert a key unless the same key already exists in that scope. Returns the row id. */
function key_add(?int $userId, string $provider, string $key, string $label): int
{
    ensure_keys_table();
    $hash = hash('sha256', $key);
    $dup = $userId === null
        ? row('SELECT id FROM api_keys WHERE user_id IS NULL AND key_hash = ?', [$hash])
        : row('SELECT id FROM api_keys WHERE user_id = ? AND key_hash = ?', [$userId, $hash]);
    if ($dup) return (int)$dup['id'];
    if ($userId !== null && (int)row('SELECT COUNT(*) c FROM api_keys WHERE user_id = ?', [$userId])['c'] >= KEYS_PER_USER) fail('Too many saved keys (max ' . KEYS_PER_USER . ')');
    q('INSERT INTO api_keys (user_id, provider, label, key_enc, key_hash, enabled, created_at) VALUES (?,?,?,?,?,1,?)', [$userId, $provider, mb_substr($label, 0, 80), key_encrypt($key), $hash, now()]);
    return (int)db()->lastInsertId();
}

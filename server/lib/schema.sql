-- KhmerDub account & subscription schema (MySQL / MariaDB, utf8mb4)

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  trial_ends_at DATETIME NULL,
  note TEXT NULL,
  last_login_at DATETIME NULL,
  last_device VARCHAR(120) NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  device VARCHAR(120) NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  months INT NULL COMMENT 'NULL = lifetime',
  price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  price_khr INT NOT NULL DEFAULT 0,
  badge VARCHAR(30) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref VARCHAR(20) NOT NULL UNIQUE,
  user_id INT UNSIGNED NOT NULL,
  plan_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency ENUM('USD','KHR') NOT NULL DEFAULT 'USD',
  status ENUM('pending','paid','expired','canceled','failed') NOT NULL DEFAULT 'pending',
  provider VARCHAR(20) NOT NULL DEFAULT 'manual',
  provider_ref VARCHAR(120) NULL,
  qr_string TEXT NULL,
  qr_image MEDIUMTEXT NULL,
  pay_url VARCHAR(500) NULL,
  raw MEDIUMTEXT NULL,
  expires_at DATETIME NOT NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  INDEX (user_id),
  INDEX (status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  plan_id INT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL COMMENT 'NULL = lifetime',
  source ENUM('payment','code','admin','trial') NOT NULL,
  order_id INT UNSIGNED NULL,
  note VARCHAR(250) NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  INDEX (user_id, ends_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS license_codes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  plan_id INT UNSIGNED NOT NULL,
  note VARCHAR(120) NULL,
  created_by INT UNSIGNED NULL,
  redeemed_by INT UNSIGNED NULL,
  redeemed_at DATETIME NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id),
  FOREIGN KEY (redeemed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(60) PRIMARY KEY,
  v MEDIUMTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_failures (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  at DATETIME NOT NULL,
  INDEX (email, at),
  INDEX (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  target VARCHAR(120) NULL,
  detail TEXT NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL,
  INDEX (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- default plans (prices are placeholders — edit them in Admin → Plans)
INSERT IGNORE INTO plans (code, name, months, price_usd, price_khr, badge, sort) VALUES
  ('1m',   '1 Month',   1,    5.00,  20000, NULL,          1),
  ('3m',   '3 Months',  3,   13.00,  52000, 'Save 13%',    2),
  ('6m',   '6 Months',  6,   24.00,  96000, 'Popular',     3),
  ('1y',   '1 Year',    12,  42.00, 168000, 'Best value',  4),
  ('life', 'Lifetime',  NULL, 99.00, 396000, 'Pay once',   5);

INSERT IGNORE INTO settings (k, v) VALUES
  ('trial_days', '3'),
  ('currency', 'USD'),
  ('payment_mode', 'manual'),
  ('registration_open', '1'),
  ('max_devices', '2'),
  ('manual_instructions', 'Scan the KHQR with ABA, ACLEDA, Wing or any Bakong app. Pay the exact amount and write your order reference in the note. Your plan turns on as soon as the payment is confirmed.'),
  ('support_contact', '');

CREATE TABLE IF NOT EXISTS api_keys (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

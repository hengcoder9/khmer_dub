# KhmerDub account server (PHP + MySQL)

Accounts, free trial, subscriptions (1 / 3 / 6 months, 1 year, lifetime), KHQR payments, license codes and an admin panel.

## Run locally (XAMPP)
1. Start **Apache** and **MySQL** in the XAMPP control panel.
2. `D:\xampp\htdocs\khmerdub` is a junction to this folder (`mklink /J D:\xampp\htdocs\khmerdub <repo>\server`).
3. Install once: `php install.php --admin-email=you@example.com --admin-password=YourPass123`
   (or open http://localhost/khmerdub/install.php). This writes `config.php` (git-ignored) and creates the `khmerdub` database.
4. Admin panel: http://localhost/khmerdub/admin/ · API health: http://localhost/khmerdub/api/health

## Go live
- Upload this folder to PHP 8.1+ hosting with MySQL, run `install.php` there, then delete `install.php`.
- Use **HTTPS**. Set `'debug' => false` in `config.php`.
- In the desktop app, set `ACCOUNT_SERVER` in `shared/types.ts` to `https://your-domain/khmerdub/api/` before building a release
  (users can also change it under Account → Account server).

## Payments
- **Manual KHQR** (works now): Admin → Settings → upload your shop's static KHQR. Customers pay and write the order
  reference (e.g. `KDAB12CD34`) in the transfer note; you confirm the order under Admin → Orders and the plan turns on.
- **AnajakPay KHQR** (automatic, USD):
  1. Admin → Settings → **AnajakPay (ABA KHQR)**: Profile ID (the key inside the API URL
     `https://anajakpay.com/api/<profile_id>/payment-gateway/v1/payments/qr-api-khqrcc`), Secret key (write-only — the
     panel only shows its last 4 characters) and Public API URL (e.g. `https://your-domain.com/khmerdub/api/`). Save.
     Values saved there override `config.php` → `anajakpay` (`api_key`, `secret`, `public_api_url`), which still works.
  2. Copy the **Webhook URL** shown there into AnajakPay → Settings → Webhook URL, then press **Test connection**
     (one status check for a made-up order: it tells you if the secret is wrong; uses 1 of the 50 requests/minute).
  3. Admin → Settings → Payment method → AnajakPay, Currency → USD.
  - Admin → Orders → **Check now** asks AnajakPay about one pending/expired AnajakPay order right away.
  - Admin → Settings → **AnajakPay checkout** picks how the buyer pays:
    - *KHQR inside the app* (default): the QR API makes a KHQR (valid 15 min) that the app shows.
    - *ABA checkout page*: the app opens AnajakPay's hosted page (`payment/requestv2/<api_key>?…&hash`) in the browser,
      with the "Open in ABA Mobile" button. No API call at creation, so it costs nothing from the rate limit.
    Each order uses one route only; both are confirmed the same way (below).
  - When it is paid, AnajakPay POSTs to `success_url` (`…/api/pay/webhook/anajakpay?ref=<order>&t=<token>`) or to the
    Webhook URL in AnajakPay Settings (set it to `…/api/pay/webhook/anajakpay`). An order turns on only when
    `hash = sha256(secret + req_time + transaction_id + amount + "SUCCESS")` verifies, `status` is SUCCESS and the amount
    matches. The customer's browser redirect (`success_hash`, `success_time`, `success_amount`) is verified the same way.
    Repeated calls do not add time twice. Rejected callbacks are listed in Admin → Audit log.
  - While the QR is on screen the app polls the server, which asks AnajakPay **Check Transaction V2**
    (`check-transv2-khqrcc`, `hash = sha1(secret + transaction_id)`) — so payments are also confirmed on `localhost`,
    without the callback. A paid amount that differs from the order is not accepted (see Admin → Audit log).
  - Rate limit: 50 requests/minute for the whole merchant (all customers). The server checks one order at most every
    6 s and makes at most one check every 2 s overall; on HTTP 429 it pauses all AnajakPay calls for `Retry-After`
    and the app shows "busy — try again in N s".
  - The callback must reach your server from the internet — it cannot work on `localhost`. Confirm orders by hand in
    Admin → Orders if a callback is ever missed.

## Rules
- New accounts get the trial set in Admin → Settings (default 3 days). After that, AI jobs and export need an active plan.
- Buying again adds time after the current plan ends. Lifetime never expires.
- Devices per account (default 2): signing in on a third device signs out the oldest.

## API keys

Admin → **API keys**: shared keys are stored AES-256-GCM encrypted and sent to the app of every account with an active trial or plan (they stop when access ends). Customers also back up their own keys to their account (restored on a new PC). Set `keys_secret` in config.php to control the encryption secret.

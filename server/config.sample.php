<?php
// Copy to config.php (install.php does this for you). config.php is git-ignored: it holds secrets.
return [
    'app_name' => 'KhmerDub Studio',
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'khmerdub',
        'user' => 'root',
        'pass' => '',
    ],
    // days a sign-in stays valid on one device
    'session_days' => 60,
    // default free trial for new accounts (Admin → Settings overrides it)
    'trial_days' => 3,
    // master secret that encrypts saved API keys in the database. Leave empty to auto-generate one (kept in the settings table);
    // set a long random string here for better protection if the database is ever copied. Changing it later makes saved keys unreadable.
    'keys_secret' => '',
    // show real error messages in API replies — keep false on a public server
    'debug' => false,
    // AnajakPay KHQR / ABA QR API — from the AnajakPay portal
    'anajakpay' => [
        // the key in the API URL: https://anajakpay.com/api/<api_key>/payment-gateway/v1/payments/qr-api-khqrcc
        'api_key' => '',
        // "Secret key" from the AnajakPay portal — signs requests and payment callbacks
        'secret' => '',
        // public address of this API for the payment callback (must be reachable from the internet)
        'public_api_url' => '', // e.g. https://your-domain.com/khmerdub/api/
    ],
];

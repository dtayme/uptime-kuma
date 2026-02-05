<?php
const PUSH_URL = "https://example.com/api/push";
const PUSH_TOKEN = "your-token";
const interval = 60;

while (true) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, PUSH_URL);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "X-Push-Token: " . PUSH_TOKEN,
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
        "status" => "up",
        "msg" => "OK",
        "ping" => "",
    ]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_exec($ch);
    curl_close($ch);
    echo "Pushed!\n";
    sleep(interval);
}

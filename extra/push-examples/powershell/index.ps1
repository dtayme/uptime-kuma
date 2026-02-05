# Filename: index.ps1
$pushURL = "https://example.com/api/push"
$pushToken = "your-token"
$interval = 60

while ($true) {
    $res = Invoke-WebRequest -Uri $pushURL -Method Post -Headers @{ "X-Push-Token" = $pushToken } -Body @{
        status = "up"
        msg = "OK"
        ping = ""
    }
    Write-Host "Pushed!"
    Start-Sleep -Seconds $interval
}

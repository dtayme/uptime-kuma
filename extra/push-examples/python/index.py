import urllib.parse
import urllib.request
import time

push_url = "https://example.com/api/push"
push_token = "your-token"
interval = 60

while True:
    payload = urllib.parse.urlencode({
        "status": "up",
        "msg": "OK",
        "ping": "",
    }).encode()
    request = urllib.request.Request(push_url, data=payload, method="POST")
    request.add_header("X-Push-Token", push_token)
    urllib.request.urlopen(request)
    print("Pushed!\n")
    time.sleep(interval)

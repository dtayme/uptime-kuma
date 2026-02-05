docker run -d --restart=always --name uptime-kuma-push -e PUSH_TOKEN="your-token" fognetx/uptime-kuma-distributed:push "https://example.com/api/push?status=up&msg=OK&ping=" 60



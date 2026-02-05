#!/bin/bash
# Filename: index.sh
PUSH_URL="https://example.com/api/push"
PUSH_TOKEN="your-token"
INTERVAL=60

while true; do
    curl -s -o /dev/null -X POST -H "X-Push-Token: $PUSH_TOKEN" -d "status=up&msg=OK&ping=" "$PUSH_URL"
    echo "Pushed!"
    sleep $INTERVAL
done

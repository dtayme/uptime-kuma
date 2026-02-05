package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

func main() {
	const PushURL = "https://example.com/api/push"
	const PushToken = "your-token"
	const Interval = 60

	for {
		payload := strings.NewReader("status=up&msg=OK&ping=")
		request, err := http.NewRequest(http.MethodPost, PushURL, payload)
		if err != nil {
			fmt.Println("Error:", err)
			time.Sleep(Interval * time.Second)
			continue
		}
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		request.Header.Set("X-Push-Token", PushToken)
		_, err = http.DefaultClient.Do(request)
		if err == nil {
			fmt.Println("Pushed!")
		} else {
			fmt.Println("Error:", err)
		}
		time.Sleep(Interval * time.Second)
	}
}

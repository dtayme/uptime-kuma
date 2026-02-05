package main

import (
	"fmt"
	"net/http"
	os "os"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: uptime-kuma-push <url> [<interval>]")
		fmt.Fprintln(os.Stderr, "Optional: set PUSH_TOKEN env var to send token via header (POST).")
		os.Exit(1)
	}

	pushURL := os.Args[1]
	pushToken := os.Getenv("PUSH_TOKEN")

	var interval time.Duration

	if len(os.Args) >= 3 {
		intervalString, err := time.ParseDuration(os.Args[2] + "s")
		interval = intervalString

		if err != nil {
			fmt.Fprintln(os.Stderr, "Error: Invalid interval", err)
			os.Exit(1)
		}

	} else {
		interval = 60 * time.Second
	}

	for {
		method := http.MethodGet
		var request *http.Request
		var err error

		if pushToken != "" {
			method = http.MethodPost
		}

		request, err = http.NewRequest(method, pushURL, nil)
		if err != nil {
			fmt.Print("Error: ", err)
			fmt.Println(" Sleeping for", interval)
			time.Sleep(interval)
			continue
		}

		if pushToken != "" {
			request.Header.Set("X-Push-Token", pushToken)
		}

		_, err = http.DefaultClient.Do(request)
		if err == nil {
			fmt.Print("Pushed!")
		} else {
			fmt.Print("Error: ", err)
		}

		fmt.Println(" Sleeping for", interval)
		time.Sleep(interval)
	}
}

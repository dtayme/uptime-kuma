/*
 * If changed, have to run `npm run build-docker-builder-go`.
 * This script should be run after a period of time (180s), because the server may need some time to prepare.
 */
package main

import (
	"crypto/tls"
	"crypto/x509"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

func main() {
	isFreeBSD := runtime.GOOS == "freebsd"

	// Is K8S + uptime-kuma as the container name
	// See #2083
	isK8s := strings.HasPrefix(os.Getenv("UPTIME_KUMA_PORT"), "tcp://")
	healthcheckInsecure := os.Getenv("UPTIME_KUMA_HEALTHCHECK_INSECURE") == "1"

	sslKey := os.Getenv("UPTIME_KUMA_SSL_KEY")
	if len(sslKey) == 0 {
		sslKey = os.Getenv("SSL_KEY")
	}

	sslCert := os.Getenv("UPTIME_KUMA_SSL_CERT")
	if len(sslCert) == 0 {
		sslCert = os.Getenv("SSL_CERT")
	}

	hostname := os.Getenv("UPTIME_KUMA_HOST")
	if len(hostname) == 0 && !isFreeBSD {
		hostname = os.Getenv("HOST")
	}
	if len(hostname) == 0 {
		hostname = "127.0.0.1"
	}

	port := ""
	// UPTIME_KUMA_PORT is override by K8S unexpectedly,
	if !isK8s {
		port = os.Getenv("UPTIME_KUMA_PORT")
	}
	if len(port) == 0 {
		port = os.Getenv("PORT")
	}
	if len(port) == 0 {
		port = "3001"
	}

	protocol := ""
	if len(sslKey) != 0 && len(sslCert) != 0 {
		protocol = "https"
	} else {
		protocol = "http"
	}

	var transport *http.Transport
	if protocol == "https" {
		transport = http.DefaultTransport.(*http.Transport).Clone()
		if healthcheckInsecure {
			log.Println("Healthcheck TLS verification is disabled via UPTIME_KUMA_HEALTHCHECK_INSECURE=1")
			transport.TLSClientConfig = &tls.Config{
				InsecureSkipVerify: true,
			}
		} else if len(sslCert) != 0 {
			certPem, err := os.ReadFile(sslCert)
			if err != nil {
				certPem = []byte(sslCert)
			}
			certPool := x509.NewCertPool()
			if certPool.AppendCertsFromPEM(certPem) {
				transport.TLSClientConfig = &tls.Config{
					RootCAs: certPool,
				}
			} else {
				log.Println("Healthcheck could not parse SSL cert for CA; using system roots")
			}
		}
	}

	client := http.Client{
		Timeout: 28 * time.Second,
	}
	if transport != nil {
		client.Transport = transport
	}

	url := protocol + "://" + hostname + ":" + port

	log.Println("Checking " + url)
	resp, err := client.Get(url)

	if err != nil {
		log.Fatalln(err)
	}

	defer resp.Body.Close()

	_, err = ioutil.ReadAll(resp.Body)

	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("Health Check OK [Res Code: %d]\n", resp.StatusCode)

}

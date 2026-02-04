# Security Policy


## Known Security Exceptions

- NTLM monitoring requires legacy algorithms (MD4/MD5/DES) for protocol compatibility. These are used only when NTLM is explicitly configured.
- Healthcheck utilities may disable TLS verification for local/self-signed setups and should not be used against untrusted remote endpoints.

# SSH Tunnel Deployment Options

This document describes three ways to expose the GTO Baseline API when the high-performance server has no public IP, but a weaker adapter server does.

## Architecture

The high-performance server runs the actual GTO API service. The public server only receives external traffic and forwards it through a reverse SSH tunnel.

```text
Client
  -> Public server
  -> Reverse SSH tunnel
  -> Private high-performance server
  -> GTO API
```

Assumptions used in the examples:

| Item | Example |
| --- | --- |
| Public server IP | `PUBLIC_SERVER_IP` |
| Public server SSH user | `public_user` |
| Private server API address | `127.0.0.1:5000` |
| Public server tunnel port | `9000` |
| Domain, when used | `api.example.com` |

On the private high-performance server, start the GTO API first:

```bash
cd /path/to/test-platform/ai
python app.py
```

For production, replace `python app.py` with a production WSGI runner such as Gunicorn on Linux or Waitress on Windows.

## Reverse SSH Tunnel

Run this command from the private high-performance server:

```bash
ssh -N \
  -R 127.0.0.1:9000:127.0.0.1:5000 \
  public_user@PUBLIC_SERVER_IP
```

Meaning:

- `127.0.0.1:5000` is the GTO API on the private server.
- `127.0.0.1:9000` is the forwarded port on the public server.
- Traffic received by the public server on `127.0.0.1:9000` is sent through SSH to the private server's `127.0.0.1:5000`.

For production, use `autossh` or `systemd` to keep the tunnel alive:

```bash
autossh -M 0 -N \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:9000:127.0.0.1:5000 \
  public_user@PUBLIC_SERVER_IP
```

## Option 1: No Nginx, Expose Public IP and Port Directly

This is the simplest option, but it exposes the SSH forwarded port directly to users.

### Tunnel Command

Run this from the private high-performance server:

```bash
ssh -N \
  -R 0.0.0.0:9000:127.0.0.1:5000 \
  public_user@PUBLIC_SERVER_IP
```

Users call:

```text
http://PUBLIC_SERVER_IP:9000/api/v1/gto-baseline/query
```

### Public Server SSHD Requirement

The public server must allow remote forwarded ports to bind publicly. In `/etc/ssh/sshd_config`:

```text
GatewayPorts clientspecified
AllowTcpForwarding yes
```

Then reload SSH:

```bash
sudo systemctl reload sshd
```

Some systems use `ssh` instead of `sshd`:

```bash
sudo systemctl reload ssh
```

### Firewall

Open the public port:

```bash
sudo ufw allow 9000/tcp
```

### Pros

- Fastest to set up.
- No Nginx or domain required.
- Useful for quick internal testing.

### Cons

- No built-in HTTPS.
- No Nginx-level rate limiting, access logs, request size limits, or TLS termination.
- Requires exposing the forwarded SSH port publicly.
- Not recommended for public production use.

## Option 2: Public IP to Nginx Forwarding

This option does not require a domain. Users call the public IP on port 80, and Nginx forwards traffic to the tunnel bound on the public server's localhost.

### Tunnel Command

Run this from the private high-performance server:

```bash
ssh -N \
  -R 127.0.0.1:9000:127.0.0.1:5000 \
  public_user@PUBLIC_SERVER_IP
```

Users call:

```text
http://PUBLIC_SERVER_IP/api/v1/gto-baseline/query
```

### Nginx Config

On the public server:

```nginx
server {
    listen 80 default_server;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
```

Reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Firewall

Open HTTP:

```bash
sudo ufw allow 80/tcp
```

The tunnel port `9000` should stay bound to `127.0.0.1` only and should not be opened publicly.

### Pros

- No domain required.
- Safer than exposing the SSH forwarded port directly.
- Nginx can provide access logs, request limits, timeout tuning, and basic rate limiting.
- The public server only does proxy work; GTO solving still runs on the private server.

### Cons

- Still plain HTTP unless you add a certificate manually.
- Some third-party clients may reject non-HTTPS API endpoints.
- Users must trust an IP-based endpoint.

## Option 3: Domain to Nginx Forwarding

This is the recommended public deployment option. A domain points to the public server, Nginx terminates HTTPS, and requests are forwarded through the SSH tunnel.

### DNS

Create an `A` record:

```text
api.example.com -> PUBLIC_SERVER_IP
```

Wait for DNS propagation before issuing the HTTPS certificate.

### Tunnel Command

Run this from the private high-performance server:

```bash
ssh -N \
  -R 127.0.0.1:9000:127.0.0.1:5000 \
  public_user@PUBLIC_SERVER_IP
```

Users call:

```text
https://api.example.com/api/v1/gto-baseline/query
```

### Nginx Config

Initial HTTP config:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
```

Reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Issue a Let's Encrypt certificate:

```bash
sudo certbot --nginx -d api.example.com
```

Certbot will update the Nginx config to serve HTTPS. After that, verify:

```bash
curl https://api.example.com/api/v1/gto-baseline/query
```

Use a real POST body for endpoint testing.

### Firewall

Open HTTP and HTTPS:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

The tunnel port `9000` should remain private to the public server.

### Pros

- Recommended for real external users.
- Supports standard HTTPS certificates.
- Clean API URL.
- Nginx can handle TLS, logs, rate limiting, request body limits, and timeouts.

### Cons

- Requires a domain.
- Requires DNS and certificate setup.
- Slightly more operational work than IP-only access.

## API Security

For any public or semi-public deployment, configure the GTO Baseline API key list on the private high-performance server:

```bash
GTO_BASELINE_API_KEYS=key_1,key_2
```

Clients should call the API with:

```http
Authorization: Bearer key_1
```

or:

```http
X-API-Key: key_1
```

This API key check happens inside the Flask app, so it works with all three deployment options.

## Operational Notes

- Keep `ai/gto/cache/dataset` and `ai/gto/cache/results` on persistent storage on the private server.
- If the SSH tunnel drops, the public endpoint will fail until the tunnel reconnects.
- Use `autossh` or a `systemd` service for the tunnel.
- Set generous proxy read timeouts because first-time turn or river realtime solving can take longer than normal HTTP requests.
- For multi-instance private servers, use shared cache storage or route the same game/query stream to the same backend instance.


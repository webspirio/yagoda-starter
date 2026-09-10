# VPS TLS termination without Coolify (host nginx + Certbot)

**Primary deployment is Coolify** (`docs/coolify-deploy.md`), whose Traefik
terminates TLS. This doc is the exit path: a plain VPS running
`docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml`,
which publishes the internal nginx on `127.0.0.1:8080`. A host-level terminator
has to sit in front of it to serve the app over HTTPS. This doc covers that
piece: host nginx + Certbot (Let's Encrypt) on Ubuntu.

Prerequisites:

- Ubuntu 22.04/24.04 VPS, Docker already installed.
- A DNS `A` record for your domain already pointing at the VPS's public IP.
- Root or sudo access over SSH.

## 1. Install nginx

```bash
sudo apt update
sudo apt install -y nginx
```

Remove the default site so unmatched `Host` headers don't fall through to the
stock welcome page:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

## 2. Configure the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # opens 80 + 443
sudo ufw enable
sudo ufw status
```

Docker-published ports aren't affected by this — `docker-compose.prod.yml`
itself publishes nothing; on this standalone path `docker-compose.standalone.yml`
publishes `127.0.0.1:8080` (the internal nginx) and `127.0.0.1:5432`
(postgres, reachable only via an SSH tunnel from the host itself — see the
comment on that port in the compose file), both loopback-only, so redis/
backend/the internal nginx are never reachable from outside the box
regardless of firewall state, and postgres only via that tunnel. This step
just locks down the host itself to SSH/HTTP/HTTPS.

## 3. Add an HTTP server block

Replace `<your-domain>` throughout this doc with your actual domain (e.g. `app.example.com`).

```bash
sudo tee /etc/nginx/sites-available/<your-domain> > /dev/null <<'EOF'
server {
    listen 80;
    server_name <your-domain>;

    # Uploads: avatars are capped at 10 MB (MEDIA_MAX_BYTES). nginx's default
    # client_max_body_size is 1 MB, which would 413 those uploads at this host
    # proxy before they reach the app. Set it a little above the app's 10 MB
    # limit so the app's own validation stays authoritative.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/<your-domain> /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

At this point `http://<your-domain>` should already proxy through to
the app (once the prod stack is running) — just not over HTTPS yet.

The `X-Forwarded-*` headers matter here: `docker-compose.prod.yml` sets
`TRUST_PROXY_HOPS: 2` on the backend (this host terminator + the internal nginx).
The internal nginx (`nginx/nginx.conf`) appends its own hop via
`$proxy_add_x_forwarded_for`, so as long as this host block sets the headers
above, the chain lines up and the backend sees the real client IP for rate
limiting instead of the internal Docker network IP.

The `client_max_body_size 12m;` line is required, not optional. The app accepts
avatar uploads up to 10 MB (`MEDIA_MAX_BYTES`; the internal `nginx/nginx.conf`
already sets a matching `client_max_body_size`), and without a matching-or-larger
limit here the host terminator returns **413 Request Entity Too Large** for any
image over 1 MB — the request never reaches the app and the frontend shows a
generic "upload failed" error. Certbot preserves this directive when it edits the
block in step 4 (it only adds the `listen 443 ssl` lines), so it survives the
HTTPS conversion. On an **existing** server whose block is already
Certbot-managed, the least-invasive fix is to add `client_max_body_size 12m;`
once at the `http {}` level in `/etc/nginx/nginx.conf` instead — it applies to
every server block.

## 4. Install Certbot and get a certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <your-domain>
```

Run it interactively — it'll ask for an email (renewal/expiry notices) and
whether to redirect HTTP to HTTPS (choose yes/redirect). Certbot edits the
server block from step 3 in place: it adds a `listen 443 ssl` block with the
certificate paths and turns the port-80 block into a redirect.

## 5. Verify renewal is wired up

Ubuntu's certbot package installs a systemd timer that renews automatically and
reloads nginx as part of the renewal hook. Confirm it's active and do a dry run:

```bash
systemctl status certbot.timer
sudo certbot renew --dry-run
```

## 6. End-to-end check

Once the prod stack (`IMAGE_TAG=sha-<commit> docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml up -d`) is
running on the box:

```bash
curl -i https://<your-domain>/api/health/ready
```

A `200` here confirms: DNS → host nginx → TLS → internal nginx → backend →
DB/Redis are all wired up correctly, and the app is reachable over HTTPS.

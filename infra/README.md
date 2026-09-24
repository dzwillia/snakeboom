# Hosting SnakeBoom

SnakeBoom runs on the Happy Path box next to the other apps: two containers behind the shared Caddy, no database.

| Piece | Where |
|---|---|
| Site | `ghcr.io/dzwillia/snakeboom-web`, container `snakeboom-web` (:3000), `https://snakeboom.com` (`www.` redirects) |
| Relay | `ghcr.io/dzwillia/snakeboom-api`, container `snakeboom-api` (:3001), `https://api.snakeboom.com` |
| Compose and env | `/opt/happypathsoft/snakeboom/{docker-compose.yml,.env}` |
| Caddy fragment | `/opt/happypathsoft/caddy/conf.d/snakeboom.caddy` |
| Deploy | `.github/workflows/deploy.yml`, on a `v*` tag or by dispatching a tag |

Both containers join the external `happypathsoft-net` network so Caddy reaches them by name. Nothing joins `db-net`; there is no Postgres role, no migration, no backup cron and nothing to add to `backup-freshness.yml`.

## One-time setup

1. **GitHub secrets** on this repo, the same three the other apps use: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`. The deploy job logs the box into GHCR with the workflow's own token, so the packages can stay private.
2. **The host directory**, over SSH on the box:
   ```bash
   sudo mkdir -p /opt/happypathsoft/snakeboom
   sudo chown "$USER" /opt/happypathsoft/snakeboom
   cd /opt/happypathsoft/snakeboom
   printf 'API_IMAGE_TAG=\nWEB_IMAGE_TAG=\nALLOWED_ORIGIN=https://snakeboom.com\n' > .env
   chmod 600 .env
   ```
   The workflow copies `docker-compose.yml` in on every deploy and fills in the two tags.
3. **DNS**, in the Route 53 hosted zone for `snakeboom.com`: three A records pointing at the box's Elastic IP, TTL 300:
   - `snakeboom.com`
   - `www.snakeboom.com`
   - `api.snakeboom.com`

   Wait until `dig +short api.snakeboom.com` answers before the first deploy; Caddy asks Let's Encrypt for certificates the moment the fragment loads, and that needs the names to resolve.
4. **First deploy:** merge to `main`, then
   ```bash
   git tag v0.10.0 && git push origin v0.10.0
   ```
   Watch the `deploy` run in Actions. It ends by polling `https://api.snakeboom.com/health` until it reports the tag. Then open `https://snakeboom.com` in two browsers.

## Day to day

- **Deploy a release:** push a `v*` tag. **Roll back:** run the `deploy` workflow by hand with an older tag; the images are still in GHCR.
- **Logs:** `docker logs -f snakeboom-api` prints one JSON line per event: rooms created and closed, matches with scores, each round with both players' netcode stats, forfeits, desyncs (with both hashes), failed rejoins. A deploy recreates the container, so the workflow first saves the old log to `/opt/happypathsoft/snakeboom/logs/relay-<timestamp>.log` (kept 30 days).
- **Is anyone playing?** `curl -s https://api.snakeboom.com/health` shows `rooms`, `players` and `queued`. A deploy restarts the relay and ends live matches with "The server restarted", so deploy when it's quiet.
- **If the Caddy step fails:** the workflow restores the previous fragment and stops. Check the mount of `conf.d` inside the caddy container (`docker inspect caddy`) matches `/etc/caddy/conf.d`, which is what the base Caddyfile imports.

## Running the images locally

```bash
docker build -f Dockerfile.api -t snakeboom-api:local .
docker build -f Dockerfile.web --build-arg VITE_API_URL=http://localhost:3101 -t snakeboom-web:local .
docker run --rm -p 3101:3001 -e ALLOWED_ORIGIN=http://localhost:3100 -e APP_VERSION=local snakeboom-api:local
docker run --rm -p 3100:3000 snakeboom-web:local     # then open http://localhost:3100
```

# Hosting SnakeBoom

SnakeBoom runs on the Happy Path box next to the other apps: two containers behind the shared Caddy, no database. Every release also stays up at its own subdomain (`v0-17-0.snakeboom.com`, the tag with dots as dashes), so a `v*` tag brings up two stacks: the current release at `snakeboom.com` and the release's own one, which outlives the next tag.

| Piece | Where |
|---|---|
| Site | `ghcr.io/dzwillia/snakeboom-web`, container `snakeboom-web` (:3000), `https://snakeboom.com` (`www.` redirects) |
| Relay | `ghcr.io/dzwillia/snakeboom-api`, container `snakeboom-api` (:3001), `https://api.snakeboom.com` |
| Compose and env | `/opt/happypathsoft/snakeboom/{docker-compose.yml,.env}` |
| Caddy fragment | `/opt/happypathsoft/caddy/conf.d/snakeboom.caddy` |
| One release `S` (say `v0-17-0`) | containers `snakeboom-web-S` and `snakeboom-api-S`, compose project `snakeboom-S` in `/opt/happypathsoft/snakeboom/releases/S/`, fragment `conf.d/snakeboom-S.caddy`, `https://S.snakeboom.com` and `https://api.S.snakeboom.com` |
| Pinned releases | `/opt/happypathsoft/snakeboom/pinned`, one slug per line |
| Scripts | `infra/{render,deploy,teardown}.sh`, copied to `/opt/happypathsoft/snakeboom/infra/` on every deploy |
| Deploy | `.github/workflows/deploy.yml`, on a `v*` tag or by dispatching a tag; `teardown.yml` removes one release |

All containers join the external `happypathsoft-net` network so Caddy reaches them by name. Nothing joins `db-net`; there is no Postgres role, no migration, no backup cron and nothing to add to `backup-freshness.yml`.

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
   The workflow copies `docker-compose.yml` in on every deploy and fills in the two tags. `releases/`, `infra/` and `logs/` appear on the first deploy.
3. **DNS**, in the Route 53 hosted zone for `snakeboom.com`: four A records pointing at the box's Elastic IP, TTL 300:
   - `snakeboom.com`
   - `www.snakeboom.com`
   - `api.snakeboom.com`
   - `*.snakeboom.com`, which covers every release: `v0-17-0.snakeboom.com` and `api.v0-17-0.snakeboom.com` both match the wildcard (a wildcard matches deeper names too, as long as no closer record exists, so never add a plain `v0-17-0` record). No per-release DNS.

   Wait until `dig +short api.snakeboom.com` and `dig +short api.v0-0-0.snakeboom.com` answer before the first deploy; Caddy asks Let's Encrypt for certificates the moment a fragment loads, and that needs the names to resolve.
4. **First deploy:** merge to `main`, then
   ```bash
   git tag v0.10.0 && git push origin v0.10.0
   ```
   Watch the `deploy` run in Actions. It ends by polling `https://api.snakeboom.com/health` and `https://api.v0-10-0.snakeboom.com/health` until both report the tag. Then open `https://snakeboom.com` in two browsers.

## Every release at its own subdomain

The relay refuses a client from another version (the protocol and the sim change between releases), so a version is only playable against its own relay, and every release runs as a full pair. The site image bakes its relay URL in at build time, so the build job makes two site images from the same source: `snakeboom-web:v0.17.0` talks to `api.v0-17-0.snakeboom.com` and is what the release's own stack runs forever; `snakeboom-web:v0.17.0-current` talks to `api.snakeboom.com` and is what `snakeboom.com` runs until the next tag. The relay image is one and the same, `snakeboom-api:v0.17.0`, run twice with a different `ALLOWED_ORIGIN`.

What a deploy of `v0.17.0` does on the box (`infra/deploy.sh`, run over SSH):

1. Renders the release with `infra/render.sh v0.17.0`: a copy of the compose file, a `.env` that sets `COMPOSE_PROJECT_NAME=snakeboom-v0-17-0`, `NAME_SUFFIX=-v0-17-0`, both image tags and `ALLOWED_ORIGIN=https://v0-17-0.snakeboom.com`, and the Caddy fragment from `infra/caddy.d/snakeboom-release.caddy.tmpl`.
2. Updates the current stack exactly as before: `.env` gets `API_IMAGE_TAG=v0.17.0` and `WEB_IMAGE_TAG=v0.17.0-current`, the relay log is saved, `docker compose up -d`.
3. Writes `releases/v0-17-0/{docker-compose.yml,.env,deployed}` and brings that stack up. The compose file is the same one; only `.env` differs, which is what gives the project and containers their suffix.
4. Installs `conf.d/snakeboom.caddy` and `conf.d/snakeboom-v0-17-0.caddy`, validates the whole Caddy config, and puts the old fragments back (and fails) if it does not validate.
5. Retention: releases are ordered by deploy time (the `deployed` file); the newest five stay, anything older is torn down unless its slug is in `pinned`. The current stack is never a candidate.
6. Reloads Caddy once, which also issues the two new certificates, and waits for both relays to report the tag.

Quick-match is per relay, so players on an old release only meet each other. Rate limits are per relay too.

**Pinning.** `/opt/happypathsoft/snakeboom/pinned` lists slugs to keep past the newest five, one per line; blank lines and `#` comments are fine:
```
# the first public playtest build
v0-11-0
```
Create the file over SSH; nothing in the deploy writes it. Pinned releases are not counted among the five.

**Tearing one down** removes the containers, the fragment, the directory and the release's images (an image the current stack still runs stays; Docker refuses to remove it). Run the `teardown` workflow with the slug or the tag, or on the box:
```bash
bash /opt/happypathsoft/snakeboom/infra/teardown.sh v0-16-0
```
Tearing down the current tag's own stack is allowed and leaves `snakeboom.com` alone. Deploying the tag again (dispatch `deploy` with it) brings the stack back; its certificate is still in Caddy's storage.

**Rolling back** is unchanged: dispatch `deploy` with an older tag. That rebuilds the tag's images (the site twice, for both hostnames), points `snakeboom.com` at it and brings the old release's own stack back if retention had removed it. A redeployed release counts as newly deployed for retention.

## Day to day

- **Deploy a release:** push a `v*` tag. **Roll back:** run the `deploy` workflow by hand with an older tag; the images are still in GHCR.
- **Logs:** `docker logs -f snakeboom-api` prints one JSON line per event: rooms created and closed, matches with scores, each round with both players' netcode stats, forfeits, desyncs (with both hashes), failed rejoins. A deploy recreates the container, so the workflow first saves the old log to `/opt/happypathsoft/snakeboom/logs/relay-<timestamp>.log` (kept 30 days). A release's own relay is `docker logs -f snakeboom-api-v0-17-0`; nothing saves those.
- **Is anyone playing?** `curl -s https://api.snakeboom.com/health` shows `rooms`, `players` and `queued`; the same for `https://api.v0-17-0.snakeboom.com/health`. A deploy restarts the current relay and ends live matches on `snakeboom.com` with "The server restarted", so deploy when it's quiet. Older releases' stacks are not restarted by a deploy.
- **Disk:** each release keeps ~335 MB of image layers (less in practice, the Node base is shared). Retention keeps it to about five plus the pinned ones; `docker system df` shows the total.
- **If the Caddy step fails:** the workflow restores the previous fragments and stops. Check the mount of `conf.d` inside the caddy container (`docker inspect caddy`) matches `/etc/caddy/conf.d`, which is what the base Caddyfile imports.
- **If only the release's own relay fails the smoke test** ("the current release is up, but ..."): `snakeboom.com` is already on the new tag. Check `dig +short api.v0-17-0.snakeboom.com` resolves to the box and `docker logs caddy` for the certificate; a dispatch of the same tag retries everything.

## Running the images locally

```bash
docker build -f Dockerfile.api -t snakeboom-api:local .
docker build -f Dockerfile.web --build-arg VITE_API_URL=http://localhost:3101 -t snakeboom-web:local .
docker run --rm -p 3101:3001 -e ALLOWED_ORIGIN=http://localhost:3100 -e APP_VERSION=local snakeboom-api:local
docker run --rm -p 3100:3000 snakeboom-web:local     # then open http://localhost:3100
```

To see what a deploy would install for a tag without touching the box:
```bash
infra/render.sh v0.17.0 /tmp/out && cat /tmp/out/.env /tmp/out/snakeboom-v0-17-0.caddy
docker compose -f /tmp/out/docker-compose.yml config
```

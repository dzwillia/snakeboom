# SnakeBoom M7 (Ship) Implementation Plan

> **For agentic workers:** work task by task on the `online` branch, commit after each task. Steps use checkbox (`- [ ]`) syntax for tracking. Interfaces, file contents and checks are given; the implementer writes them.

**Goal:** SnakeBoom at `https://snakeboom.com` (online spec milestone M7, v1.0.0):
- Two Docker images (static site, relay), a compose file and a Caddy fragment in the Happy Path pattern.
- A GitHub Actions workflow: a `v*` tag builds, pushes and deploys; a manual dispatch redeploys a tag.
- A one-time setup runbook: DNS, host directory, `.env`, GitHub secrets.
- A "play on a computer" page for touch-only devices.
- README: hosting and the deploy procedure.
- The remote playtest: two machines in different cities.

**Spec:** `docs/superpowers/specs/2026-09-24-snakeboom-online-design.md`, sections 7 (touch-only page) and 8 (deployment).

## Global Constraints

- Everything from M5 and M6 still applies. Commits on `online` with the trailer; `pnpm test`, `pnpm typecheck`, `pnpm build` green after every task.
- **Follow the ClearDeal layout exactly** so the Happy Path runbooks apply: images `ghcr.io/dzwillia/snakeboom-api` and `ghcr.io/dzwillia/snakeboom-web`, containers `snakeboom-api` (:3001) and `snakeboom-web` (:3000), both on the external `happypathsoft-net` network only (no database, no `db-net`), compose and `.env` under `/opt/happypathsoft/snakeboom/`, the Caddy fragment installed as `conf.d/snakeboom.caddy`, `GET /health` returning `{status, version, timestamp}`.
- Nothing in this repo may contain a secret or the box's address. The workflow reads `EC2_HOST`, `EC2_USER` and `EC2_SSH_KEY` from GitHub secrets, like the other apps.
- Prod only (spec decision 10). No stage compose, no stage fragment, no basic auth.
- The agent does not SSH into the box or edit DNS. The runbook gives the developer the exact commands, and the deploy workflow does the rest.

## Review Focus

1. **The images run the same code the tests ran.** The api image runs `dist-server/index.js` from the Vite server build; the web image serves `dist/` built with `VITE_API_URL=https://api.snakeboom.com`. Both are built locally with Docker in Task 1 and smoke-tested before any workflow exists.
2. **SPA fallback and WebSockets through Caddy.** `/r/ABC123` must serve `index.html` from the web container, and `wss://api.snakeboom.com/ws` must upgrade through the shared Caddy. Task 2 checks the fallback locally with `docker run`; the upgrade is checked on the box after the first deploy (Caddy proxies WebSockets by default).
3. **Deploys never leave the box half-configured.** The deploy script installs the compose file only after `docker compose config -q` passes and the fragment only after `caddy validate` passes, restoring the previous fragment otherwise, exactly as ClearDeal does. Task 3 keeps that structure.
4. **Origin and protocol.** The relay runs with `ALLOWED_ORIGIN=https://snakeboom.com`, and the client's baked-in relay URL must match `api.snakeboom.com`; a mismatch shows "Connection lost" for everyone. Task 5's first deploy checks `/health` over HTTPS and a real lobby from two browsers.
5. **Touch-only devices.** A phone opening a link sees the "play on a computer" page with a Copy button and never a broken game. Task 4 tests the detection helper and checks the page in a narrow, coarse-pointer Playwright context.

---

### Task 1: Dockerfiles

**Files:**
- Create: `Dockerfile.api`, `Dockerfile.web`, `docker/web.Caddyfile`, `.dockerignore`

**`Dockerfile.api`** (multi-stage, `node:22-alpine`, pnpm via corepack):
1. `deps`: copy `package.json` and `pnpm-lock.yaml`, `pnpm install --frozen-lockfile`.
2. `build`: copy the source, `pnpm build:server` (the Vite SSR bundle to `dist-server/index.js`).
3. `runtime`: `pnpm install --frozen-lockfile --prod` for `ws`, `hono` and `@hono/node-server`; copy `dist-server/`; `ENV NODE_ENV=production PORT=3001`; `EXPOSE 3001`; `USER node`; `CMD ["node", "dist-server/index.js"]`. `APP_VERSION` and `ALLOWED_ORIGIN` come from the environment at run time.

**`Dockerfile.web`**: build stage installs deps and runs `pnpm exec vite build` with `ARG VITE_API_URL` and `ARG APP_VERSION` (the version define reads `package.json`, so the arg only matters for a label); runtime `caddy:2-alpine` copying `dist/` to `/srv` and `docker/web.Caddyfile` to `/etc/caddy/Caddyfile`; `EXPOSE 3000`.

**`docker/web.Caddyfile`**:
```
:3000 {
	root * /srv
	encode gzip zstd
	try_files {path} /index.html
	file_server
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
	header /index.html Cache-Control "no-cache"
}
```

**`.dockerignore`**: `node_modules`, `dist`, `dist-server`, `.git`, `docs`, `*.log`, `.superpowers`.

- [ ] **Step 1: Write the files.**
- [ ] **Step 2: Build and smoke locally.** `docker build -f Dockerfile.api -t snakeboom-api:local .` then `docker run --rm -p 3101:3001 -e ALLOWED_ORIGIN=http://localhost:5199 -e APP_VERSION=local snakeboom-api:local` and `curl localhost:3101/health` shows `"version":"local"`. `docker build -f Dockerfile.web --build-arg VITE_API_URL=http://localhost:3101 -t snakeboom-web:local .` then `docker run --rm -p 3100:3000 snakeboom-web:local`; `curl -s localhost:3100/r/ABC234 | grep -c '<div id="game">'` is 1 (SPA fallback) and `curl -sI localhost:3100/assets/ | head -1` is a 404 without a listing.
- [ ] **Step 3: Commit** `build: Docker images for the site and the relay`.

---

### Task 2: Compose and the Caddy fragment

**Files:**
- Create: `infra/snakeboom/docker-compose.yml`, `infra/snakeboom/.env.example`, `infra/caddy.d/snakeboom.caddy`, `infra/README.md`

**`docker-compose.yml`**:
```yaml
services:
  snakeboom-api:
    image: ghcr.io/dzwillia/snakeboom-api:${API_IMAGE_TAG:-latest}
    container_name: snakeboom-api
    restart: unless-stopped
    environment:
      PORT: "3001"
      APP_VERSION: ${API_IMAGE_TAG:-latest}
      ALLOWED_ORIGIN: ${ALLOWED_ORIGIN:?set ALLOWED_ORIGIN in .env}
    networks: [happypathsoft-net]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
  snakeboom-web:
    image: ghcr.io/dzwillia/snakeboom-web:${WEB_IMAGE_TAG:-latest}
    container_name: snakeboom-web
    restart: unless-stopped
    networks: [happypathsoft-net]
networks:
  happypathsoft-net:
    external: true
```
(`wget` is in Alpine's busybox; if the api image lacks it, use `node -e` with `fetch`.)

**`.env.example`**: `API_IMAGE_TAG=`, `WEB_IMAGE_TAG=`, `ALLOWED_ORIGIN=https://snakeboom.com`.

**`snakeboom.caddy`**:
```
snakeboom.com {
	encode gzip zstd
	reverse_proxy snakeboom-web:3000
}
www.snakeboom.com {
	redir https://snakeboom.com{uri} permanent
}
api.snakeboom.com {
	reverse_proxy snakeboom-api:3001 {
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-For {remote_host}
	}
}
```

**`infra/README.md`**: the one-time setup runbook (Task 5 writes the final text; this task creates the file with the structure).

- [ ] **Step 1: Write the files.** `docker compose -f infra/snakeboom/docker-compose.yml config -q` passes with the example env (copy it to `.env` in a temp dir for the check; never commit a `.env`). `docker run --rm -v "$PWD/infra/caddy.d:/c" caddy:2-alpine caddy validate --adapter caddyfile --config /c/snakeboom.caddy` passes.
- [ ] **Step 2: Commit** `infra: compose file and Caddy fragment for snakeboom.com`.

---

### Task 3: GitHub Actions

**Files:**
- Create: `.github/workflows/test.yml`, `.github/workflows/deploy.yml`

**`test.yml`**: on push and pull_request to any branch; Node 22 with pnpm via `pnpm/action-setup` (reading the version from `packageManager` in `package.json`, added in this task as `"packageManager": "pnpm@<installed version>"`), `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Also `workflow_call` so deploy can reuse it.

**`deploy.yml`**: on `push: tags: ['v*']` and `workflow_dispatch` with an input `tag`. Jobs:
1. `test`: `uses: ./.github/workflows/test.yml`.
2. `build`: needs test. Log in to GHCR with `GITHUB_TOKEN` (`packages: write`); `docker/build-push-action` for `Dockerfile.api` → `ghcr.io/dzwillia/snakeboom-api:${TAG}` and `Dockerfile.web` with `VITE_API_URL=https://api.snakeboom.com` → `ghcr.io/dzwillia/snakeboom-web:${TAG}`, `platforms: linux/amd64` (the box is x86). `TAG` is the tag name or the dispatch input.
3. `deploy`: needs build. `scp` `infra/snakeboom/docker-compose.yml` and `infra/caddy.d/snakeboom.caddy` to `/tmp/` on the host (`appleboy/scp-action` or plain `scp` with the key written to a file, matching ClearDeal), then `ssh` (`appleboy/ssh-action`) running the remote script:
   - `cd /opt/happypathsoft/snakeboom`, `docker login ghcr.io` with the token passed as an env, back up `.env`, set `API_IMAGE_TAG` and `WEB_IMAGE_TAG` to `$TAG` in `.env` (sed in place, append if absent).
   - `docker compose -f /tmp/docker-compose.yml --env-file .env config -q` then `cp /tmp/docker-compose.yml .`; `docker compose pull`; `docker compose up -d`.
   - Fragment: `cp /tmp/snakeboom.caddy /opt/happypathsoft/caddy/conf.d/snakeboom.caddy.new`; `docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` after moving `.new` into place (keep the previous file as `.bak`; on failure restore it); `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
   - Smoke: `for i in 1..30: curl -sf https://api.snakeboom.com/health | grep "\"version\":\"$TAG\"" && break; sleep 2`, fail if never.
   The fragment path inside the caddy container mirrors ClearDeal's mount; the runbook says to check `docker inspect caddy` for the exact conf.d mount if the reload step fails.

- [ ] **Step 1: Write the workflows and add `packageManager`.** `act` is not required; validate YAML with `pnpm exec js-yaml` or a quick `node -e` parse.
- [ ] **Step 2: Commit** `ci: test on push, deploy on tag`.

---

### Task 4: The "play on a computer" page

**Files:**
- Create: `src/client/device.ts`, `src/client/device.test.ts`
- Modify: `src/client/screens.ts` (+ test), `src/client/main.ts`, `src/client/style.css`

**`device.ts`**: `isTouchOnly(mq: (query: string) => boolean): boolean` returns true when `(pointer: coarse)` matches and `(hover: hover)` does not. `main.ts` calls it with `matchMedia` before anything else; when true, and the path is an invite link, it shows `screens.touchOnly(link)` (the link with a Copy button and "SnakeBoom needs a keyboard. Open this link on a computer.") and stops; when true on the bare title it shows the same page without a link. Keys still work if a keyboard is attached later (the page listens for `keydown` and reloads into the normal flow).

- [ ] **Step 1: Write the failing tests** (`device.test.ts`: coarse without hover → true; coarse with hover → false; fine pointer → false; `screens.test.ts`: the page shows the link and the copy button).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Check in Playwright** with `hasTouch: true`, `isMobile: true`, viewport 390×844 (Chromium reports coarse pointer without hover for that): the page shows; a desktop context still shows the title.
- [ ] **Step 4: Commit** `feat(client): play-on-a-computer page for touch-only devices`.

---

### Task 5: Runbook, README, first deploy, v1.0.0

**Files:**
- Modify: `infra/README.md`, `README.md`, `package.json` (version `1.0.0`)

**Runbook (`infra/README.md`)**, in this order:
1. **GitHub:** repo secrets `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` (same values as the other apps). GHCR packages are created on first push; make them readable by the box (public, or a PAT in the box's docker login, whichever the other apps use).
2. **Host:** `sudo mkdir -p /opt/happypathsoft/snakeboom && cd /opt/happypathsoft/snakeboom`, create `.env` from `infra/snakeboom/.env.example` with `ALLOWED_ORIGIN=https://snakeboom.com`, `chmod 600 .env`. No `provision-product.sh`, no backup cron, nothing in `backup-freshness.yml`.
3. **DNS (Route 53 hosted zone for snakeboom.com):** A records for `snakeboom.com`, `www.snakeboom.com`, `api.snakeboom.com` → the box's Elastic IP, TTL 300. Wait for `dig +short api.snakeboom.com` to answer before the first deploy, or Caddy can't get certificates.
4. **First deploy:** `git tag v1.0.0 && git push origin v1.0.0`, watch the Actions run, then `curl https://api.snakeboom.com/health`.
5. **Rollback:** dispatch `deploy.yml` with an older tag.
6. **Logs:** `docker logs -f snakeboom-api` (JSON lines: rooms, matches, forfeits, desyncs).

- [ ] **Step 1: Write the runbook and the README's Hosting section** (what runs where, how a deploy happens, how to read the logs).
- [ ] **Step 2: Developer does the one-time setup** (secrets, host dir, DNS). The agent waits for the go.
- [ ] **Step 3: Tag `v1.0.0`** (bump `package.json` first, commit `chore: v1.0.0`), push, watch the workflow, and check `https://snakeboom.com` from two browsers on two networks: a full match, a rejoin, a rematch.
- [ ] **Step 4: Playtest** with a friend in another city. The "one more match" test, remotely.

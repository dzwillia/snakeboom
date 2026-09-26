#!/usr/bin/env bash
# Runs ON THE BOX, from the deploy workflow, after the workflow has copied infra/ to $STAGED.
# Deploys one tag twice: as the current release (snakeboom.com, exactly as before) and as its own
# release stack at $SLUG.snakeboom.com, then reloads Caddy once, prunes old release stacks and smokes both.
#
#   TAG=v0.17.0 GHCR_USER=... GHCR_TOKEN=... bash /tmp/snakeboom-deploy/infra/deploy.sh
#
# Optional: API_URL (default https://api.snakeboom.com), KEEP_RELEASES (default 5), STAGED, APP_DIR, CONF_DIR.
set -euo pipefail

: "${TAG:?set TAG (v0.17.0)}"
: "${GHCR_USER:?set GHCR_USER}"
: "${GHCR_TOKEN:?set GHCR_TOKEN}"
API_URL=${API_URL:-https://api.snakeboom.com}
DOMAIN=${DOMAIN:-snakeboom.com}
KEEP_RELEASES=${KEEP_RELEASES:-5}
STAGED=${STAGED:-/tmp/snakeboom-deploy}
APP_DIR=${APP_DIR:-/opt/happypathsoft/snakeboom}
CONF_DIR=${CONF_DIR:-/opt/happypathsoft/caddy/conf.d}
INFRA="$STAGED/infra"
RENDERED="$STAGED/rendered"

caddy_validate() { docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; }
caddy_reload() { docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; }

# Polls URL/health until it reports TAG; $2 is the number of 2 s attempts.
wait_for_version() {
  local url=$1 attempts=$2 i
  for ((i = 0; i < attempts; i++)); do
    if curl -sf "$url/health" | grep -q "\"version\":\"$TAG\""; then return 0; fi
    sleep 2
  done
  return 1
}

# Render first: it also validates the tag and gives us the slug.
rm -rf "$RENDERED"
SLUG=$(bash "$INFRA/render.sh" "$TAG" "$RENDERED")
RELEASE_DIR="$APP_DIR/releases/$SLUG"
echo "deploying $TAG: current release, and https://$SLUG.$DOMAIN"

cd "$APP_DIR"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

### 1. The current release: snakeboom.com, exactly as before. The site image is the -current build
###    (VITE_API_URL=https://api.snakeboom.com); the relay image is the same one every stack of this tag runs.
cp .env .env.bak
set_env() {
  local key=$1 value=$2 tmp
  if grep -q "^$key=" .env; then
    tmp=$(mktemp)
    sed "s/^$key=.*/$key=$value/" .env > "$tmp" && cat "$tmp" > .env
    rm -f "$tmp"
  else
    echo "$key=$value" >> .env
  fi
}
set_env API_IMAGE_TAG "$TAG"
set_env WEB_IMAGE_TAG "$TAG-current"
docker compose -f "$INFRA/snakeboom/docker-compose.yml" --env-file .env config -q
cp "$INFRA/snakeboom/docker-compose.yml" docker-compose.yml
docker compose pull

# Recreating the relay container drops its log, and the log is where playtest numbers live.
mkdir -p logs
docker logs snakeboom-api > "logs/relay-$(date +%Y%m%dT%H%M%S).log" 2>&1 || true
find logs -name 'relay-*.log' -mtime +30 -delete || true
docker compose up -d

### 2. The release's own stack: releases/$SLUG, compose project snakeboom-$SLUG, containers *-$SLUG.
mkdir -p "$RELEASE_DIR"
cp "$RENDERED/docker-compose.yml" "$RELEASE_DIR/docker-compose.yml"
cp "$RENDERED/.env" "$RELEASE_DIR/.env"
chmod 600 "$RELEASE_DIR/.env"
docker compose -f "$RELEASE_DIR/docker-compose.yml" config -q
docker compose -f "$RELEASE_DIR/docker-compose.yml" pull
docker compose -f "$RELEASE_DIR/docker-compose.yml" up -d
date +%s > "$RELEASE_DIR/deployed"

# Keep the scripts and templates on the box, so a release can be torn down or re-rendered by hand.
mkdir -p infra/snakeboom infra/caddy.d
cp "$INFRA/render.sh" "$INFRA/teardown.sh" "$INFRA/deploy.sh" infra/
cp "$INFRA/snakeboom/docker-compose.yml" infra/snakeboom/
cp "$INFRA/caddy.d/snakeboom-release.caddy.tmpl" "$INFRA/caddy.d/snakeboom.caddy" infra/caddy.d/

### 3. Caddy: install both fragments, and put the old ones back if the whole config no longer validates.
BACKUP="$STAGED/caddy-backup"
rm -rf "$BACKUP" && mkdir -p "$BACKUP"
restore_fragment() {
  local name=$1
  if [ -f "$BACKUP/$name" ]; then cp "$BACKUP/$name" "$CONF_DIR/$name"; else rm -f "$CONF_DIR/$name"; fi
}
for name in snakeboom.caddy "snakeboom-$SLUG.caddy"; do
  [ -f "$CONF_DIR/$name" ] && cp "$CONF_DIR/$name" "$BACKUP/$name"
done
cp "$INFRA/caddy.d/snakeboom.caddy" "$CONF_DIR/snakeboom.caddy"
cp "$RENDERED/snakeboom-$SLUG.caddy" "$CONF_DIR/snakeboom-$SLUG.caddy"
if ! caddy_validate; then
  echo "Caddy fragments failed validation; restoring the previous ones"
  restore_fragment snakeboom.caddy
  restore_fragment "snakeboom-$SLUG.caddy"
  exit 1
fi

### 4. Retention: keep the newest $KEEP_RELEASES release stacks (by deploy time) plus every slug in
###    $APP_DIR/pinned; tear the rest down. The current stack is never a candidate.
PINNED=()
if [ -f pinned ]; then
  while IFS= read -r line; do
    line=${line%%#*}
    line=${line//[[:space:]]/}
    [ -n "$line" ] && PINNED+=("$line")
  done < pinned
fi
is_pinned() {
  local p
  for p in "${PINNED[@]+"${PINNED[@]}"}"; do [ "$p" = "$1" ] && return 0; done
  return 1
}
rank=0
for dir in "$APP_DIR"/releases/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  stamp=$(cat "$dir/deployed" 2>/dev/null || echo 0)
  echo "$stamp $name"
done | sort -rn | while read -r _ name; do
  rank=$((rank + 1))
  if [ "$name" = "$SLUG" ] || [ "$rank" -le "$KEEP_RELEASES" ]; then continue; fi
  if is_pinned "$name"; then echo "keeping $name (pinned)"; continue; fi
  echo "tearing down $name (older than the newest $KEEP_RELEASES)"
  APP_DIR=$APP_DIR CONF_DIR=$CONF_DIR bash "$INFRA/teardown.sh" --no-reload "$name"
done

### 5. One reload picks up the new fragments and the removed ones.
caddy_reload

### 6. Smoke: both relays report the tag. The release's own hostnames are new to Caddy, so its
###    certificate is being issued right now; give that one longer.
if ! wait_for_version "$API_URL" 30; then
  echo "smoke test failed: $API_URL does not report $TAG"; docker logs --tail 50 snakeboom-api; exit 1
fi
echo "current release is $TAG"
if ! wait_for_version "https://api.$SLUG.$DOMAIN" 60; then
  echo "the current release is up, but https://api.$SLUG.$DOMAIN does not report $TAG (DNS? certificate?)"
  docker logs --tail 50 "snakeboom-api-$SLUG"
  docker logs --tail 30 caddy 2>&1 | grep -i "$SLUG" || true
  exit 1
fi
echo "deployed $TAG at https://$SLUG.$DOMAIN"

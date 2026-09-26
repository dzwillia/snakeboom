#!/usr/bin/env bash
# Runs ON THE BOX. Removes one release's own stack: its containers, its Caddy fragment, its directory and
# its images (an image the current stack still runs stays, Docker refuses to remove those).
#
#   bash /opt/happypathsoft/snakeboom/infra/teardown.sh v0-16-0     # or v0.16.0
#
# --no-reload skips the Caddy reload (the deploy reloads once for everything it did).
# The current release at snakeboom.com is a different stack and is never touched.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/happypathsoft/snakeboom}
CONF_DIR=${CONF_DIR:-/opt/happypathsoft/caddy/conf.d}
REGISTRY=ghcr.io/dzwillia
RELOAD=1

if [ "${1:-}" = "--no-reload" ]; then RELOAD=0; shift; fi
if [ $# -ne 1 ]; then echo "usage: $0 [--no-reload] <slug-or-tag>   (v0-16-0 or v0.16.0)" >&2; exit 2; fi
SLUG=${1//./-}
if ! [[ $SLUG =~ ^v[0-9]+-[0-9]+-[0-9]+(-[0-9a-z-]+)?$ ]]; then
  echo "teardown.sh: '$1' is not a release slug (v0-16-0)" >&2
  exit 2
fi
DIR="$APP_DIR/releases/$SLUG"

# The tag the images carry: from the stack's .env, or the slug's first three numbers.
TAG=""
[ -f "$DIR/.env" ] && TAG=$(sed -n 's/^API_IMAGE_TAG=//p' "$DIR/.env" | head -1)
if [ -z "$TAG" ]; then
  TAG=$(echo "$SLUG" | sed -E 's/^v([0-9]+)-([0-9]+)-([0-9]+).*/v\1.\2.\3/')
fi

if [ -f "$DIR/docker-compose.yml" ]; then
  docker compose -f "$DIR/docker-compose.yml" down --remove-orphans
else
  docker rm -f "snakeboom-api-$SLUG" "snakeboom-web-$SLUG" 2>/dev/null || true
fi
rm -f "$CONF_DIR/snakeboom-$SLUG.caddy"
rm -rf "$DIR"

for image in "$REGISTRY/snakeboom-api:$TAG" "$REGISTRY/snakeboom-web:$TAG" "$REGISTRY/snakeboom-web:$TAG-current"; do
  if docker image inspect "$image" >/dev/null 2>&1; then
    if docker image rm "$image" >/dev/null 2>&1; then echo "removed $image"; else echo "kept $image (still in use)"; fi
  fi
done

if [ "$RELOAD" = 1 ]; then
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
fi
echo "tore down $SLUG"

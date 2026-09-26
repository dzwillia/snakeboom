#!/usr/bin/env bash
# Renders one release's stack from the templates next to this script:
#
#   infra/render.sh v0.17.0 out/
#
# writes out/docker-compose.yml (a copy), out/.env (the slug, tags and origin the compose file reads) and
# out/snakeboom-v0-17-0.caddy (the Caddy fragment). The slug is the tag with dots as dashes; it is the
# subdomain, the container-name suffix and the compose project suffix. Plain bash and sed, nothing else,
# so it runs the same on the box and on a laptop.
set -euo pipefail

usage() {
  echo "usage: $0 <tag> <outdir>   (tag like v0.17.0)" >&2
  exit 2
}

[ $# -eq 2 ] || usage
TAG=$1
OUT=$2
HERE=$(cd "$(dirname "$0")" && pwd)

# vX.Y.Z, optionally with a prerelease part (v0.18.0-rc.1); the slug must be a valid DNS label.
if ! [[ $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9a-z.-]+)?$ ]]; then
  echo "render.sh: '$TAG' is not a release tag (vX.Y.Z)" >&2
  exit 2
fi
SLUG=${TAG//./-}
if [ ${#SLUG} -gt 63 ]; then
  echo "render.sh: slug '$SLUG' is longer than a DNS label allows" >&2
  exit 2
fi

mkdir -p "$OUT"
cp "$HERE/snakeboom/docker-compose.yml" "$OUT/docker-compose.yml"
sed "s/\${SLUG}/$SLUG/g" "$HERE/caddy.d/snakeboom-release.caddy.tmpl" > "$OUT/snakeboom-$SLUG.caddy"
{
  echo "# Rendered by infra/render.sh for $TAG; a deploy of the same tag rewrites it."
  echo "COMPOSE_PROJECT_NAME=snakeboom-$SLUG"
  echo "NAME_SUFFIX=-$SLUG"
  echo "API_IMAGE_TAG=$TAG"
  echo "WEB_IMAGE_TAG=$TAG"
  echo "ALLOWED_ORIGIN=https://$SLUG.snakeboom.com"
} > "$OUT/.env"
echo "$SLUG"

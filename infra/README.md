# Hosting SnakeBoom

SnakeBoom runs on the Happy Path box next to the other apps: two containers behind the shared Caddy, no database.

| Piece | Where |
|---|---|
| Site | `ghcr.io/dzwillia/snakeboom-web`, container `snakeboom-web` (:3000), `https://snakeboom.com` |
| Relay | `ghcr.io/dzwillia/snakeboom-api`, container `snakeboom-api` (:3001), `https://api.snakeboom.com` |
| Compose and env | `/opt/happypathsoft/snakeboom/{docker-compose.yml,.env}` |
| Caddy fragment | `/opt/happypathsoft/caddy/conf.d/snakeboom.caddy` |

(The one-time setup runbook is written in M7 Task 5.)

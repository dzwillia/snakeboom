# GitHub Actions secrets for the deploy workflow

Set these once on this repo (Settings → Secrets and variables → Actions, or with `gh` as below).
They are the same three values the ClearDeal and Captain's Log deploy workflows use, so copy them
from where those came from: the box's address and SSH key from your infra notes, not from GitHub
(secrets can't be read back once set).

| Secret | What it is | Example value (placeholder) |
|---|---|---|
| `EC2_HOST` | The box's public address: the Elastic IP, or a DNS name that resolves to it | `203.0.113.10` |
| `EC2_USER` | The SSH login on the box | `ec2-user` |
| `EC2_SSH_KEY` | The **private** key that logs in as that user, the whole file including the BEGIN/END lines | contents of `~/.ssh/happypathsoft-prod.pem` |

No other secrets are needed:

- The workflow pushes and pulls images with its own `GITHUB_TOKEN`; the box logs into GHCR with that token during the deploy.
- The relay has no database, so there is no `DATABASE_URL`.
- `ALLOWED_ORIGIN` is not a secret; it lives in `/opt/happypathsoft/snakeboom/.env` on the box.

## Setting them with the GitHub CLI

```bash
cd ~/src/dzwillia/snakeboom
gh secret set EC2_HOST --body "203.0.113.10"
gh secret set EC2_USER --body "ec2-user"
gh secret set EC2_SSH_KEY < ~/.ssh/happypathsoft-prod.pem
gh secret list
```

Replace the address and the key path with your real ones. `gh secret set NAME < file` reads the value from
the file, so the key's newlines survive intact; pasting a multi-line key into the web form works too.

## Checking they work

After they are set, the first tag push runs `deploy.yml`. If SSH fails, the `Deploy on the host` step
shows the error: a wrong key gives `Permission denied (publickey)`, a wrong host gives a connection
timeout. Nothing is changed on the box until the SSH step runs.

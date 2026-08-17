# AetherSpec Production Deployment

This directory contains deployment scripts and configuration for production deployment on Hetzner.

## Current version

The latest deployed version is **v0.4.0**. Always deploy from a version tag rather than a branch head unless you are testing a feature branch.

```bash
# Deploy latest stable release
./deploy.sh v0.4.0
```

## Quick Start

### 1. Set up SSH key on Hetzner server

```bash
# From Oracle VM
ssh-copy-id root@157.180.57.246
# Enter root password when prompted
```

### 2. Configure production credentials

```bash
cd infra/deploy/env
cp .env.prod.example .env.prod
# Edit .env.prod with real credentials
nano .env.prod
```

Required credentials:

- `POSTGRES_PASSWORD` — PostgreSQL root password
- `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` — MinIO credentials
- `OLLAMA_API_KEY` — Your Ollama Cloud API key
- `LANGFUSE_*` — Langfuse credentials (if using)

### 3. Deploy

```bash
# Deploy latest stable release
./deploy.sh v0.4.0

# Deploy specific version tag
./deploy.sh v0.0.1
```

The script performs the following:

- Checks out the requested tag on the server.
- Installs dependencies (`pnpm install`, Python venv).
- Builds the Go gateway, TypeScript agent, and React web app.
- Deploys static web files to `/var/www/aetherspec/`.
- Ensures the production environment file is in place.
- Restarts `aetherspec-gateway` and `aetherspec-agent` systemd services.
- Verifies the gateway health endpoint.

### 4. Verify

Use the Python helper scripts or browser to verify. Do **not** use `curl` directly on the host (per project policy, use generated Python scripts for API tests).

```bash
# Gateway health via Python
python3 -c "import urllib.request, ssl; ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=0; print(urllib.request.urlopen('https://api.aetherspec.ai/healthz', context=ctx).read().decode())"

# Web app
open https://aetherspec.ai

# Check service status
ssh root@157.180.57.246 "systemctl status aetherspec-gateway aetherspec-agent"
```

Expected gateway root response:

```json
{ "name": "aetherspec-gateway", "status": "foundation", "version": "0.4.0" }
```

## MinIO configuration for new document types

Before running a new document workflow (e.g., SRS-BE), upload the corresponding Cognia config to the templates bucket with the correct prefix:

```bash
mc alias set local http://127.0.0.1:9000 <access-key> <secret-key>
mc cp --recursive /path/to/srd-config/ local/aetherspec-templates/srs-be/
```

Template API path mapping:

- `GET /api/template/srs/sections` → `aetherspec-templates/srs-be/sections.yaml`
- `GET /api/template/srs/section-guide/01` → `aetherspec-templates/srs-be/section-guide/01.md`
- `GET /api/template/srs/template` → `aetherspec-templates/srs-be/srs-be.md`

## Manual Deployment (Alternative)

If the automated script fails, deploy manually:

```bash
ssh root@157.180.57.246

# On server
cd /opt/aetherspec-v2
git fetch --tags
git checkout v0.4.0
pnpm install --frozen-lockfile

# Build
cd apps/gateway
export PATH=/usr/local/go/bin:$PATH
go build -o bin/gateway ./cmd

cd ../agent
pnpm build

cd ../web
pnpm build

# Deploy web
sudo cp -r dist/* /var/www/aetherspec/

# Install systemd services
sudo cp ../../infra/deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable aetherspec-gateway aetherspec-agent
sudo systemctl restart aetherspec-gateway aetherspec-agent

# Verify
systemctl status aetherspec-gateway aetherspec-agent
python3 -c "import urllib.request, ssl; ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=0; print(urllib.request.urlopen('http://127.0.0.1:3000/healthz', context=ctx).read().decode())"
```

## Rollback

```bash
# Rollback to previous version
./deploy.sh v0.2.7
```

## Logs

```bash
# Gateway logs
ssh root@157.180.57.246 "journalctl -u aetherspec-gateway -f"

# Agent logs
ssh root@157.180.57.246 "journalctl -u aetherspec-agent -f"
```

## Security Notes

- ✅ Uses SSH key authentication (no passwords in scripts)
- ✅ `.env.prod` is gitignored (never commit credentials)
- ✅ Systemd services run with security hardening flags
- ❌ DO NOT store server passwords in GitHub secrets

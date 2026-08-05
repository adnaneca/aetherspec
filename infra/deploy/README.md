# AetherSpec Production Deployment

This directory contains deployment scripts and configuration for production deployment on Hetzner.

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
# Deploy latest main branch
./deploy.sh main

# Deploy specific version tag
./deploy.sh v0.0.1
```

### 4. Verify

```bash
# Gateway health
curl https://api.aetherspec.ai/healthz

# Web app
open https://aetherspec.ai

# Check service status
ssh root@157.180.57.246 "systemctl status aetherspec-gateway aetherspec-agent"
```

## Manual Deployment (Alternative)

If the automated script fails, deploy manually:

```bash
ssh root@157.180.57.246

# On server
cd /opt/aetherspec-v2
git checkout v0.0.1
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
sudo systemctl start aetherspec-gateway aetherspec-agent

# Verify
systemctl status aetherspec-gateway aetherspec-agent
curl http://127.0.0.1:3000/healthz
```

## Rollback

```bash
# Rollback to previous version
./deploy.sh v0.0.0
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

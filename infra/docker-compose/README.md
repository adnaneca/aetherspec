# AetherSpec Local Development Stack

This directory contains the Docker Compose configuration for local development.

## Quick Start

```bash
# Start all services
docker compose -f docker-compose.dev.yml up -d

# Check status
docker compose -f docker-compose.dev.yml ps

# View logs
docker compose -f docker-compose.dev.yml logs -f

# Stop all services
docker compose -f docker-compose.dev.yml down

# Reset (delete all data)
docker compose -f docker-compose.dev.yml down -v
```

## Services

| Service        | Port                       | Credentials                     |
| -------------- | -------------------------- | ------------------------------- |
| **PostgreSQL** | 5432                       | `aetherspec/devpassword`        |
| **MinIO**      | 9000 (API), 9001 (Console) | `aetheradmin/aetherdevpassword` |
| **Keycloak**   | 8080                       | `admin/admin`                   |
| **Langfuse**   | 3001                       | See Langfuse docs               |

## Data Persistence

Data is stored in `./data/` which is gitignored. To reset:

```bash
docker compose -f docker-compose.dev.yml down -v
rm -rf data/
```

## Connecting from Host

- **PostgreSQL:** `postgresql://aetherspec:devpassword@localhost:5432/aetherspec`
- **MinIO:** `http://localhost:9000` (use console at `http://localhost:9001`)
- **Keycloak:** `http://localhost:8080` (realm: `aetherspec`)
- **Langfuse:** `http://localhost:3001`

## Production Note

This configuration is for **local development only**. For production deployment on Hetzner, use the systemd service approach documented in Phase 8.

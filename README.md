# aetherspec

AetherSpec is a structured requirements authoring platform. It turns high-level business requirements into signed-off, traceable specification documents using a multi-agent workflow.

## Features

- **Business Requirements (BRS)** workflow — generate, negotiate, validate, and approve BRS sections.
- **Software / Backend Requirements (SRS-BE)** workflow — derive detailed `SR-BE-xxx` requirements from signed-off BRS sections with automatic upstream injection and traceability.
- **Multi-agent orchestration** — orchestrator, writer, negotiator, validator, and suggestion agents.
- **Template-driven** — document templates, section guides, and agent instructions live in MinIO and are docType-aware (`brs`, `srs`).
- **Interactive Aether Studio** — React frontend with live workflow cards, section editor, and split/preview modes.
- **Traceability matrix** — generated documents include `Traces-To` links and appendices for approval, history, and revisions.
- **MinIO-backed storage** — drafts, approved sections, and merged documents are stored under project buckets.

## Version

Current release: **v0.4.0**

See the [v0.4.0 release notes](https://github.com/adnaneca/aetherspec/releases/tag/v0.4.0).

## Monorepo structure

| Path | Description |
|------|-------------|
| `apps/gateway` | Go Fiber API server — templates, documents, workflow orchestration, MinIO/Postgres integration |
| `apps/agent` | TypeScript Mastra-based agent sidecar — workflow agents and state machines |
| `apps/web` | React + Vite frontend — Aether Studio, SSO login, workflow UI |
| `packages/shared-types` | Shared TypeScript definitions |
| `packages/proto` | Shared protobuf/contract definitions |
| `scripts` | Python utilities (`merge_brs.py`, `merge_srs.py`) |
| `infra/deploy` | Hetzner production deployment scripts and systemd services |

## Quick start

### Development

```bash
pnpm install
pnpm build
pnpm test
```

Gateway (requires Postgres + MinIO):

```bash
cd apps/gateway
export PATH=/usr/local/go/bin:$PATH
go test ./...
go run ./cmd
```

### Production deployment

See [`infra/deploy/README.md`](./infra/deploy/README.md).

```bash
./infra/deploy/deploy.sh v0.4.0
```

## Links

- Production web app: https://aetherspec.ai
- Production API: https://api.aetherspec.ai
- Release notes: https://github.com/adnaneca/aetherspec/releases

#!/bin/bash
# AetherSpec — Production Deployment Script
# Usage: ./deploy.sh <version>
# Example: ./deploy.sh v0.0.1
#
# This script deploys AetherSpec v3 to the Hetzner test server via SSH.
# It uses SSH key authentication (passwordless) for security.

set -e

SERVER_HOST="157.180.57.246"
SERVER_USER="root"
SERVER_DIR="/opt/aetherspec-v2"
VERSION="${1:-feat/projects-frontend}"

echo "🚀 Starting deployment to Hetzner..."
echo "   Server: ${SERVER_USER}@${SERVER_HOST}"
echo "   Version: ${VERSION}"
echo ""

# Deploy via SSH
ssh -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_HOST}" bash -s << EOF
set -e
cd ${SERVER_DIR}

echo "📦 Checking out version: ${VERSION}"
git fetch origin
# Determine if VERSION is a tag or a branch and checkout appropriately.
if git rev-parse -q --verify "refs/tags/${VERSION}" >/dev/null; then
  git checkout -B "deploy-${VERSION}" "${VERSION}" -- || true
  git reset --hard "${VERSION}"
elif git rev-parse -q --verify "refs/remotes/origin/${VERSION}" >/dev/null; then
  git checkout -B "${VERSION}" "origin/${VERSION}" -- || true
  git reset --hard "origin/${VERSION}"
else
  echo "❌ Version ${VERSION} is not a known branch or tag"
  exit 1
fi
git clean -fd

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

echo "🐍 Installing Python scripts dependencies..."
if [ -f scripts/requirements.txt ]; then
  python3 -m venv /opt/aetherspec-v2/venv
  /opt/aetherspec-v2/venv/bin/pip install -q -r scripts/requirements.txt
fi

echo "🔨 Building gateway..."
cd apps/gateway
export PATH=/usr/local/go/bin:\$PATH
go build -o bin/gateway ./cmd
cd ..

echo "🔨 Building agent..."
cd agent
pnpm build
cd ..

echo "🔨 Building web..."
cd web
pnpm build
cd ..

echo "📁 Deploying web static files..."
sudo cp -r web/dist/* /var/www/aetherspec/

echo "🔄 Ensuring environment file..."
if [ ! -f infra/deploy/env/gateway.env ] && [ -f infra/deploy/env/.env.prod.example ]; then
  cp infra/deploy/env/.env.prod.example infra/deploy/env/gateway.env
fi

echo "🔄 Restarting services..."
sudo systemctl daemon-reload
sudo systemctl restart aetherspec-gateway
sudo systemctl restart aetherspec-agent

sleep 5

echo "✅ Checking health..."
curl -sf http://127.0.0.1:3000/healthz && echo "Gateway OK" || exit 1
systemctl is-active aetherspec-gateway || exit 1
systemctl is-active aetherspec-agent || exit 1

echo "✅ Deployment successful!"
EOF

echo ""
echo "🎉 Deployment complete!"
echo "   Gateway:  https://api.aetherspec.ai/healthz"
echo "   Web App:  https://aetherspec.ai"

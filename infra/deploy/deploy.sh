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
VERSION="${1:-main}"

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
git checkout -B "${VERSION}" "origin/${VERSION}"

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

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

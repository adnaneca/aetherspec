#!/bin/bash
# Sync project source (excluding node_modules, .git, build outputs) to shared folder.
# Run this after making changes to keep /media/sf_Shared/Aether/aetherspec/ up to date.

set -e

SRC="/home/vboxuser/projects/aetherspec"
DEST="/media/sf_Shared/Aether/aetherspec"

mkdir -p "$DEST"

rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='apps/*/node_modules' \
  --exclude='packages/*/node_modules' \
  --exclude='dist' \
  --exclude='build' \
  --exclude='bin' \
  --exclude='.turbo' \
  --exclude='*.tsbuildinfo' \
  --exclude='apps/web/e2e/.auth/' \
  --exclude='apps/web/test-results/' \
  --exclude='infra/docker-compose/data/' \
  --exclude='infra/docker-compose/langfuse-data/' \
  "$SRC/" "$DEST/"

echo "Synced $SRC -> $DEST"

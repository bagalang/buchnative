#!/usr/bin/env bash
# seed.sh — фирма + базов сметкоплан + супер-админ (идемпотентно).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BAGA_ROOT="$(cd "$ROOT/../.." && pwd)"
cd "$BAGA_ROOT"

export DROCK_PORT="${DROCK_PORT:-16579}"
export BN_ADMIN_EMAIL="${BN_ADMIN_EMAIL:-superadmin}"
export BN_ADMIN_PASSWORD="${BN_ADMIN_PASSWORD:-123+123}"
export BN_SEED_COMPANY="${BN_SEED_COMPANY:-BN-DEMO}"

exec ./baga -I . -I app-product app-product/buchnative/start.baga seed

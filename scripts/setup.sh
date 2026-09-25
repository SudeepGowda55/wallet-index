#!/usr/bin/env bash
# One-time setup after cloning: pinned dependencies (git submodules) + swap-vm's JS dependencies used by remappings.
set -euo pipefail
cd "$(dirname "$0")/.."
git submodule update --init --recursive
(cd lib/swap-vm && (yarn install --frozen-lockfile --ignore-scripts || npm install --ignore-scripts))
forge build
echo "setup done: run ./scripts/test_all.sh"

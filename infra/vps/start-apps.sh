#!/bin/bash
# Starts everything in docker-compose.yml with the current settings
# (after db-replace.sh --no-start).
set -euo pipefail
. "$(dirname "$0")/lib.sh"
compose up -d

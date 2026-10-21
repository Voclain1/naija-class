#!/bin/bash
# Starts everything in docker-compose.yml with the current settings
# (after db-replace.sh --no-start).
set -euo pipefail
cd "$(dirname "$0")"
files=(-f docker-compose.yml)
if grep -q '^VPS_MODE=rehearsal$' deploy.env; then files+=(-f docker-compose.rehearsal.yml); fi
if grep -q '^CBT_ENABLED=true$' deploy.env; then export COMPOSE_PROFILES=cbt; fi
docker compose --env-file deploy.env "${files[@]}" up -d

#!/usr/bin/env bash
# Seeds the Docker Redmine from compose.yaml with users, projects, versions,
# custom fields and issues, and prints a regular user's API key.
#
#   docker compose -f dev/redmine/compose.yaml up -d
#   dev/redmine/seed.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/compose.yaml")

# Wait for Redmine to finish migrating and start serving.
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:3000/login"; then break; fi
  sleep 3
done

"${compose[@]}" exec -T redmine sh -c 'SECRET_KEY_BASE="$REDMINE_SECRET_KEY_BASE" exec bin/rails runner -' < "$here/seed.rb" | tee /dev/stderr | tail -n 1

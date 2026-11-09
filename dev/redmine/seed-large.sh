#!/usr/bin/env bash
# Adds a "Load" team with thousands of issues to the Docker Redmine, for
# checking Redline's speed on large projects. Run seed.sh first.
#
#   dev/redmine/seed-large.sh                       # 5,000 issues
#   LARGE_ISSUES=20000 dev/redmine/seed-large.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker compose -f "$here/compose.yaml" exec -T -e LARGE_ISSUES="${LARGE_ISSUES:-5000}" redmine \
  sh -c 'SECRET_KEY_BASE="$REDMINE_SECRET_KEY_BASE" exec bin/rails runner -' < "$here/seed-large.rb"

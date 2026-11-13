#!/bin/bash
set -e
PRO_QUESTIONNAIRE_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPRESS_QUESTIONNAIRE_DIR="/Users/isaachines/.codex/worktrees/express-page-organizer/Express-Content-Questionnaire-v1"
npm --prefix "$PRO_QUESTIONNAIRE_DIR" run local:start
npm --prefix "$EXPRESS_QUESTIONNAIRE_DIR" run local:start
for attempt in {1..60}; do
  pro_status=$(curl -fsS 'http://localhost:5173/_local/api/health' 2>/dev/null || true)
  express_status=$(curl -fsS 'http://localhost:5174/_local/api/health' 2>/dev/null || true)
  if [[ "$pro_status" == *'"localOnly":true'* && "$express_status" == *'"format":"local-express-v1"'* ]]; then
    open 'http://localhost:5173'
    open 'http://localhost:5174'
    exit 0
  fi
  sleep 0.25
done
echo 'A local server did not become ready. Check .local-preview/server.log in each checkout.'
exit 1

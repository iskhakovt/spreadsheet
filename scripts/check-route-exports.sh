#!/usr/bin/env bash
# Route files must only export `Route` (and types). Any other named export is
# silently kept in the main bundle by TanStack Router's autoCodeSplitting,
# which the plugin warns about but doesn't fail on. This guard turns that
# warning into a CI error.
set -euo pipefail

# `if` exempts the pipe from set -e, and pipefail makes the test true only when
# both greps succeed (= at least one offending export survived the filter).
if offenders=$(grep -rnE '^export ' packages/web/src/routes --include='*.ts' --include='*.tsx' \
    | grep -vE ':[0-9]+:export (const Route |type |interface |default )'); then
  echo "Route files may only export 'Route' (or types). Move components/utilities elsewhere:" >&2
  echo "$offenders" >&2
  exit 1
fi

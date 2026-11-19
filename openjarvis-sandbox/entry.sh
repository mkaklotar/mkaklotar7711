#!/bin/sh
# `probe` runs the containment and security checks; anything else goes to jarvis.
set -e
if [ "${1:-}" = "probe" ]; then
  status=0
  /opt/oj/bin/python -I /opt/oj-sandbox/probes/containment.py || status=1
  /opt/oj/bin/python -I /opt/oj-sandbox/probes/security_probe.py || status=1
  exit "$status"
fi
exec /opt/oj/bin/jarvis "$@"

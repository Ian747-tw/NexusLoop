#!/usr/bin/env bash
set -euo pipefail

HOURS="${1:-12}"
DEMO_PROJECT="examples/gpt_pretraining"

echo "Starting ${HOURS}-hour overnight verification run"
echo "Demo project: ${DEMO_PROJECT}"

# Initialize demo project if needed
if [ ! -d "${DEMO_PROJECT}/.nxl" ]; then
    echo "Initializing demo project..."
    cd "${DEMO_PROJECT}"
    nxl init --auto --project-mode improve --skill-pack drl --plugin none
    cd -
fi

# Start nxl run with wall-clock budget
START_TIME=$(date +%s)
END_TIME=$((START_TIME + HOURS * 3600))

echo "Run started at $(date)"
echo "Will finish at $(date -d @${END_TIME})"

# Run nxl with model-switch simulation every 2 hours
CYCLES=0
HANDOFFS=0
VIOLATIONS=0

while [ $(date +%s) -lt ${END_TIME} ]; do
    # Check if nxl is still running
    if ! pgrep -f "nxl run" > /dev/null; then
        echo "nxl run process ended"
        break
    fi

    # Every 2 hours: simulate model switch (kill and restart with different --provider)
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $((ELAPSED % 7200)) -eq 0 ] && [ $ELAPSED -gt 0 ]; then
        echo "[$ELAPSED s] Simulating model switch..."
        # Rotate provider
        PROVIDER=$(rotate_provider)
        pkill -f "nxl run" || true
        sleep 2
        (cd "${DEMO_PROJECT}" && nxl run --provider ${PROVIDER} --once) &
    fi

    sleep 60
    CYCLES=$((CYCLES + 1))

    # Check for NON_NEGOTIABLE violations in events.jsonl
    VIOLATIONS=$(grep -c "NON_NEGOTIABLE" "${DEMO_PROJECT}/.nxl/events.jsonl" 2>/dev/null || echo 0)
    HANDOFFS=$(grep -c "SessionClearing" "${DEMO_PROJECT}/.nxl/events.jsonl" 2>/dev/null || echo 0)

    echo "[$(date +%H:%M)] cycles=${CYCLES} handoffs=${HANDOFFS} violations=${VIOLATIONS}"
done

echo ""
echo "=== Overnight Run Summary ==="
echo "Cycles completed: ${CYCLES}"
echo "Handoffs: ${HANDOFFS}"
echo "NON_NEGOTIABLE violations: ${VIOLATIONS}"

# Exit codes
if [ ${VIOLATIONS} -gt 0 ]; then
    echo "FAILED: ${VIOLATIONS} violations detected"
    exit 1
fi
if [ ${CYCLES} -lt 100 ]; then
    echo "FAILED: only ${CYCLES} cycles (expected ≥100)"
    exit 1
fi
if [ ${HANDOFFS} -lt 3 ]; then
    echo "FAILED: only ${HANDOFFS} handoffs (expected ≥3)"
    exit 1
fi

echo "PASSED: All overnight criteria met"
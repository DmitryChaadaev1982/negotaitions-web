#!/usr/bin/env bash
set -euo pipefail

# Read-only production transcription audit exporter.
# Usage (on server):
#   set -a; source .env.production; set +a
#   ./scripts/audit/transcription/export-production-transcription-audit.sh
#
# Optional:
#   SESSION_IDS="id1 id2" ./scripts/audit/transcription/export-production-transcription-audit.sh
#   OUT_ROOT="/var/www/negotaitions/audit/transcription-local-e2e" ./scripts/audit/transcription/export-production-transcription-audit.sh

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

OUT_ROOT="${OUT_ROOT:-/var/www/negotaitions/audit/transcription-local-e2e}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_OUT="${OUT_ROOT}/run-${TIMESTAMP}"
mkdir -p "${RUN_OUT}"

DEFAULT_SESSION_IDS=(
  "cmr6mmnse0009llm1ibevs2cl"
  "cmr6nd1ob0012llm15xcsv1xy"
  "cmr6nll0r001rllm1fqevbcz3"
  "cmr6nw0ro002ellm1dtqlesq1"
  "cmr6obf9n0032llm1i2nve1ob"
)

if [[ -n "${SESSION_IDS:-}" ]]; then
  # shellcheck disable=SC2206
  TARGET_IDS=(${SESSION_IDS})
else
  TARGET_IDS=("${DEFAULT_SESSION_IDS[@]}")
fi

echo "Output: ${RUN_OUT}"
printf "%s\n" "${TARGET_IDS[@]}" > "${RUN_OUT}/session-ids.txt"

for SESSION_ID in "${TARGET_IDS[@]}"; do
  OUT="${RUN_OUT}/${SESSION_ID}"
  mkdir -p "${OUT}/"{db,logs,reports}

  psql "${DATABASE_URL}" -x -c "
select *
from \"Recording\"
where \"sessionId\" = '${SESSION_ID}'
order by \"createdAt\" desc;
" > "${OUT}/db/recording.txt" 2>&1

  psql "${DATABASE_URL}" -x -c "
select *
from \"Transcript\"
where \"sessionId\" = '${SESSION_ID}'
order by \"createdAt\" desc;
" > "${OUT}/db/transcript.txt" 2>&1

  psql "${DATABASE_URL}" -x -c "
select *
from \"TranscriptSegment\"
where \"transcriptId\" = (
  select id
  from \"Transcript\"
  where \"sessionId\" = '${SESSION_ID}'
  order by \"createdAt\" desc
  limit 1
)
order by \"orderIndex\" asc;
" > "${OUT}/db/transcript-segments.txt" 2>&1

  psql "${DATABASE_URL}" -x -c "
select
  id,
  \"sessionId\",
  \"participantType\",
  name,
  email,
  \"sessionRoleId\",
  \"sessionRoleName\",
  \"joinedAt\",
  \"leftAt\"
from \"SessionParticipant\"
where \"sessionId\" = '${SESSION_ID}'
order by \"createdAt\" asc;
" > "${OUT}/db/session-participants.txt" 2>&1

  psql "${DATABASE_URL}" -At -c "
select jsonb_pretty(\"processingMetadata\"::jsonb)
from \"Transcript\"
where \"sessionId\" = '${SESSION_ID}'
order by \"createdAt\" desc
limit 1;
" > "${OUT}/db/processing-metadata.json" 2>&1

  psql "${DATABASE_URL}" -At -c "
select coalesce(\"rawModelOutput\"::text, 'null')
from \"AiAnalysis\"
where \"sessionId\" = '${SESSION_ID}'
limit 1;
" > "${OUT}/db/ai-raw-model-output.json" 2>&1

  psql "${DATABASE_URL}" -At -c "
select coalesce(\"speakerMapping\"::text, 'null')
from \"Transcript\"
where \"sessionId\" = '${SESSION_ID}'
order by \"createdAt\" desc
limit 1;
" > "${OUT}/db/speaker-mapping.json" 2>&1

  psql "${DATABASE_URL}" -x -c "
select
  t.id as transcript_id,
  t.status as transcript_status,
  t.\"speakerMappingStatus\",
  t.\"diarizationStatus\",
  t.strategy,
  t.\"qualityPassStatus\",
  t.\"alignmentStatus\",
  t.\"alignmentConfidence\"
from \"Transcript\" t
where t.\"sessionId\" = '${SESSION_ID}'
order by t.\"createdAt\" desc
limit 1;
" > "${OUT}/db/transcript-status-summary.txt" 2>&1

  # API status snapshots (read-only, requires app server reachable on localhost).
  curl -fsS "http://127.0.0.1:3000/api/sessions/${SESSION_ID}/materials/status?participantId=audit-readonly" \
    > "${OUT}/reports/materials-status-api.json" 2>/dev/null || true
  curl -fsS "http://127.0.0.1:3000/api/sessions/${SESSION_ID}/transcript?participantId=audit-readonly" \
    > "${OUT}/reports/transcript-api.json" 2>/dev/null || true

  sudo journalctl -u negotaitions-poc -n 120000 --no-pager \
    | awk -v sid="${SESSION_ID}" 'BEGIN{IGNORECASE=1} $0 ~ sid || /transcrib|speechkit|diariz|speaker|mapping|recording-status|voximplant|materials\/status|audio-activity|failed|error|warn/' \
    > "${OUT}/logs/session-transcription.log" || true

  cat > "${OUT}/reports/notes.md" <<EOF
# Session ${SESSION_ID}

- Audit mode: read-only (no DB writes, no transcript overwrite).
- If recording media file is accessible locally, run ffprobe manually and save:
  - \`ffprobe -hide_banner -show_streams -show_format <file> > ffprobe.txt\`
- Variant comparison outputs should be written to files only, never persisted to production DB.
EOF
done

cat > "${RUN_OUT}/README.md" <<EOF
# Production transcription audit export

- Generated at: ${TIMESTAMP}
- Sessions:
$(printf '  - %s\n' "${TARGET_IDS[@]}")

This export is read-only and does not modify transcript rows.
EOF

echo "Audit export complete: ${RUN_OUT}"

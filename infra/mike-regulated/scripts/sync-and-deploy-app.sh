#!/usr/bin/env bash
# From laptop: sync repo to regulated EC2 and run host bootstrap via SSM.
set -euo pipefail

INSTANCE_ID="${INSTANCE_ID:-i-02b8a8a87893167fe}"
REGION="${AWS_REGION:-us-east-1}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUCKET="${DOCS_BUCKET:-mike-regulated-docsbucket-bsaz62kx5erd}"
TS=$(date +%Y%m%d%H%M%S)
ARCHIVE="/tmp/mike-regulated-src-${TS}.tgz"
S3_KEY="deploys/mike-src-${TS}.tgz"

echo "Packing ${REPO_ROOT} (excluding node_modules/.git)..."
tar -C "$REPO_ROOT" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='backend/node_modules' \
  --exclude='frontend/.next' \
  --exclude='backend/dist' \
  -czf "$ARCHIVE" .

echo "Uploading s3://${BUCKET}/${S3_KEY}"
aws s3 cp "$ARCHIVE" "s3://${BUCKET}/${S3_KEY}" --region "$REGION"
rm -f "$ARCHIVE"

# Ensure pgrst jwt file exists on host
if [[ ! -f /tmp/pgrst_jwt.json ]]; then
  echo "Missing /tmp/pgrst_jwt.json — regenerate first" >&2
  exit 1
fi
aws s3 cp /tmp/pgrst_jwt.json "s3://${BUCKET}/deploys/pgrst.json" --region "$REGION"

COMMAND_ID=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --timeout-seconds 3600 \
  --parameters commands="[
    \"set -euo pipefail\",
    \"aws s3 cp s3://${BUCKET}/${S3_KEY} /tmp/mike-src.tgz --region ${REGION}\",
    \"aws s3 cp s3://${BUCKET}/deploys/pgrst.json /opt/mike-regulated/pgrst.json --region ${REGION}\",
    \"rm -rf /opt/mike-regulated/src\",
    \"mkdir -p /opt/mike-regulated/src\",
    \"tar -xzf /tmp/mike-src.tgz -C /opt/mike-regulated/src\",
    \"# rename pgrst keys\",
    \"python3 - <<'PY'\\nimport json\\nfrom pathlib import Path\\np=Path('/opt/mike-regulated/pgrst.json')\\nd=json.loads(p.read_text())\\nout={'PGRST_JWT_SECRET': d.get('secret') or d.get('PGRST_JWT_SECRET'), 'PGRST_SERVICE_JWT': d.get('jwt') or d.get('PGRST_SERVICE_JWT')}\\np.write_text(json.dumps(out))\\nprint('pgrst keys ready')\\nPY\",
    \"# compose env\",
    \"set -a; source /opt/mike-regulated/stack-outputs.env; set +a\",
    \"DB_JSON=\\\$(aws secretsmanager get-secret-value --region ${REGION} --secret-id \\\$DB_SECRET_ARN --query SecretString --output text)\",
    \"DB_USER=\\\$(echo \\\$DB_JSON | jq -r .username)\",
    \"DB_PASS=\\\$(echo \\\$DB_JSON | jq -r .password)\",
    \"DB_NAME=\\\$(echo \\\$DB_JSON | jq -r .dbname)\",
    \"DB_HOST=\\\$(echo \\\$DB_JSON | jq -r '.host // \\\"127.0.0.1\\\"')\",
    \"PGRST_JWT_SECRET=\\\$(jq -r .PGRST_JWT_SECRET /opt/mike-regulated/pgrst.json)\",
    \"cat >/opt/mike-regulated/compose.env <<EOF\\nPGRST_DB_URI=postgres://\\\${DB_USER}:\\\${DB_PASS}@\\\${DB_HOST}:5432/\\\${DB_NAME}\\nPGRST_DB_ROLE=\\\${DB_USER}\\nPGRST_JWT_SECRET=\\\${PGRST_JWT_SECRET}\\nCOGNITO_USER_POOL_ID=\\\${COGNITO_USER_POOL_ID}\\nCOGNITO_CLIENT_ID=\\\${COGNITO_CLIENT_ID}\\nCOGNITO_REGION=${REGION}\\nNEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001\\nEOF\",
    \"chmod +x /opt/mike-regulated/src/infra/mike-regulated/scripts/host-bootstrap-app.sh\",
    \"/opt/mike-regulated/src/infra/mike-regulated/scripts/host-bootstrap-app.sh\"
  ]" \
  --query 'Command.CommandId' --output text)

echo "SSM CommandId=${COMMAND_ID}"
echo "Waiting (builds can take 15–30+ min on t3.small)..."
aws ssm wait command-executed --region "$REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '{Status:Status,Out:StandardOutputContent,Err:StandardErrorContent}' --output json

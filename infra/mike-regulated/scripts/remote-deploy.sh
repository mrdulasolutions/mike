#!/bin/bash
# Executed on the EC2 host after tarball extract to /opt/mike-regulated/src
set -euo pipefail

set -a
# shellcheck disable=SC1091
source /opt/mike-regulated/stack-outputs.env
set +a

REGION="${AWS_REGION:-us-east-1}"
ROOT=/opt/mike-regulated/src
SQL="$ROOT/infra/mike-regulated/sql/schema-regulated.sql"
COMPOSE_DIR="$ROOT/infra/mike-regulated/docker"

# swap for builds on t3.small
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

DB_JSON=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$DB_SECRET_ARN" --query SecretString --output text)
MANTLE_JSON=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id mike-regulated/staging/mantle --query SecretString --output text)
PGRST_JWT_SECRET=$(jq -r .PGRST_JWT_SECRET /opt/mike-regulated/pgrst.json)
PGRST_SERVICE_JWT=$(jq -r .PGRST_SERVICE_JWT /opt/mike-regulated/pgrst.json)

DB_USER=$(echo "$DB_JSON" | jq -r .username)
DB_PASS=$(echo "$DB_JSON" | jq -r .password)
DB_NAME=$(echo "$DB_JSON" | jq -r .dbname)
DB_HOST=$(echo "$DB_JSON" | jq -r '.host // "127.0.0.1"')
DB_PORT=$(echo "$DB_JSON" | jq -r '.port // 5432')

export DB_USER DB_PASS DB_HOST DB_PORT DB_NAME
PGRST_DB_URI=$(python3 - <<'PY'
import os, urllib.parse
u = os.environ["DB_USER"]
p = os.environ["DB_PASS"]
h = os.environ["DB_HOST"]
port = os.environ["DB_PORT"]
n = os.environ["DB_NAME"]
print(
    "postgres://"
    + urllib.parse.quote(u)
    + ":"
    + urllib.parse.quote(p)
    + f"@{h}:{port}/{n}"
)
PY
)

echo "==> Schema"
docker exec -i mike-postgres psql -U "$DB_USER" -d "$DB_NAME" < "$SQL"

DOWNLOAD_SIGNING_SECRET=$(openssl rand -hex 32)
USER_API_KEYS_ENCRYPTION_SECRET=$(openssl rand -hex 32)

OPENAI_API_KEY=$(echo "$MANTLE_JSON" | jq -r .OPENAI_API_KEY)
OPENAI_BASE_URL=$(echo "$MANTLE_JSON" | jq -r .OPENAI_BASE_URL)
OPENAI_API_MODE=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_API_MODE // "auto"')
OPENAI_MODELS=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_MODELS // empty')
OPENAI_LOW_MODELS=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_LOW_MODELS // empty')
OPENAI_MODEL_LABELS=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_MODEL_LABELS // empty')
OPENAI_COMPAT_ANY_MODEL=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_COMPAT_ANY_MODEL // "true"')

cat >/opt/mike-regulated/app.env <<EOF
NODE_ENV=production
PORT=3001
REGULATED_MODE=true
AWS_REGION=$REGION
S3_BUCKET_NAME=$S3_BUCKET_NAME
DATABASE_URL=$PGRST_DB_URI
SUPABASE_URL=http://127.0.0.1:8000
SUPABASE_SECRET_KEY=$PGRST_SERVICE_JWT
COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID
COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
COGNITO_REGION=$REGION
FRONTEND_URL=http://127.0.0.1:3000
DOWNLOAD_SIGNING_SECRET=$DOWNLOAD_SIGNING_SECRET
USER_API_KEYS_ENCRYPTION_SECRET=$USER_API_KEYS_ENCRYPTION_SECRET
OPENAI_API_KEY=$OPENAI_API_KEY
OPENAI_BASE_URL=$OPENAI_BASE_URL
OPENAI_API_MODE=$OPENAI_API_MODE
OPENAI_MODELS=$OPENAI_MODELS
OPENAI_LOW_MODELS=$OPENAI_LOW_MODELS
OPENAI_MODEL_LABELS=$OPENAI_MODEL_LABELS
OPENAI_COMPAT_ANY_MODEL=$OPENAI_COMPAT_ANY_MODEL
EOF

cat >/opt/mike-regulated/compose.env <<EOF
PGRST_DB_URI=$PGRST_DB_URI
PGRST_DB_ROLE=$DB_USER
PGRST_JWT_SECRET=$PGRST_JWT_SECRET
COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID
COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
COGNITO_REGION=$REGION
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001
EOF

cd "$COMPOSE_DIR"
docker compose --env-file /opt/mike-regulated/compose.env up -d --build

sleep 10
echo "==> containers"
docker ps --format '{{.Names}}: {{.Status}}'
curl -sS http://127.0.0.1:3001/health || echo backend-health-fail
curl -sS -o /dev/null -w 'gateway:%{http_code}\n' http://127.0.0.1:8000/healthz || true
echo DONE

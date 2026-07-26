#!/usr/bin/env bash
# Run on the mike-regulated EC2 host (via SSM) after code is synced.
set -euo pipefail

ROOT="${ROOT:-/opt/mike-regulated/src}"
SQL="${ROOT}/infra/mike-regulated/sql/schema-regulated.sql"
COMPOSE_DIR="${ROOT}/infra/mike-regulated/docker"
APP_ENV=/opt/mike-regulated/app.env
STACK_ENV=/opt/mike-regulated/stack-outputs.env

# shellcheck disable=SC1090
source "$STACK_ENV"

REGION="${AWS_REGION:-us-east-1}"
DB_SECRET_ARN="${DB_SECRET_ARN:?}"
MANTLE_SECRET_ARN="mike-regulated/staging/mantle"

echo "==> Loading secrets"
DB_JSON=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$DB_SECRET_ARN" --query SecretString --output text)
MANTLE_JSON=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$MANTLE_SECRET_ARN" --query SecretString --output text)

DB_USER=$(echo "$DB_JSON" | jq -r .username)
DB_PASS=$(echo "$DB_JSON" | jq -r .password)
DB_NAME=$(echo "$DB_JSON" | jq -r .dbname)
DB_HOST=$(echo "$DB_JSON" | jq -r '.host // "127.0.0.1"')
DB_PORT=$(echo "$DB_JSON" | jq -r '.port // 5432')

PGRST_JWT_SECRET=$(jq -r .PGRST_JWT_SECRET /opt/mike-regulated/pgrst.json)
PGRST_SERVICE_JWT=$(jq -r .PGRST_SERVICE_JWT /opt/mike-regulated/pgrst.json)
DOWNLOAD_SIGNING_SECRET=$(openssl rand -hex 32)
USER_API_KEYS_ENCRYPTION_SECRET=$(openssl rand -hex 32)

OPENAI_API_KEY=$(echo "$MANTLE_JSON" | jq -r .OPENAI_API_KEY)
OPENAI_BASE_URL=$(echo "$MANTLE_JSON" | jq -r .OPENAI_BASE_URL)
OPENAI_API_MODE=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_API_MODE // "auto"')
OPENAI_MODELS=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_MODELS // ""')
OPENAI_LOW_MODELS=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_LOW_MODELS // ""')
OPENAI_MODEL_LABELS=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_MODEL_LABELS // ""')
OPENAI_COMPAT_ANY_MODEL=$(echo "$MANTLE_JSON" | jq -r '.OPENAI_COMPAT_ANY_MODEL // "true"')

export PGRST_DB_URI="postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
export PGRST_DB_ROLE="$DB_USER"
export PGRST_JWT_SECRET
export COGNITO_USER_POOL_ID
export COGNITO_CLIENT_ID
export COGNITO_REGION="$REGION"

echo "==> Apply schema"
docker exec -i mike-postgres psql -U "$DB_USER" -d "$DB_NAME" < "$SQL"

echo "==> Write app.env"
cat > "$APP_ENV" <<EOF
NODE_ENV=production
PORT=3001
REGULATED_MODE=true
AWS_REGION=$REGION
S3_BUCKET_NAME=$S3_BUCKET_NAME
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}
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

echo "==> Docker compose up"
cd "$COMPOSE_DIR"
export NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001
docker compose --env-file /opt/mike-regulated/compose.env up -d --build

echo "==> Health"
sleep 5
curl -sf http://127.0.0.1:3001/health || true
curl -sf http://127.0.0.1:8000/healthz || true
docker ps --format '{{.Names}}: {{.Status}}'
echo DONE

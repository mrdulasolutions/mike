#!/usr/bin/env bash
# Deploy / update the mike-regulated CloudFormation stack (cheap MVP by default).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK_NAME="${STACK_NAME:-mike-regulated}"
REGION="${AWS_REGION:-us-east-1}"
TEMPLATE="${ROOT}/cfn/mike-regulated.yaml"
ENV_NAME="${ENVIRONMENT_NAME:-staging}"
COST_PROFILE="${COST_PROFILE:-mvp}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account=${ACCOUNT} Region=${REGION} Stack=${STACK_NAME} CostProfile=${COST_PROFILE}"

if [[ "${ACCOUNT}" != "547519647117" ]]; then
  echo "WARNING: expected Privus account 547519647117, got ${ACCOUNT}" >&2
  read -r -p "Continue anyway? [y/N] " ans
  [[ "${ans:-}" == "y" || "${ans:-}" == "Y" ]] || exit 1
fi

PARAMS=(
  "ParameterKey=EnvironmentName,ParameterValue=${ENV_NAME}"
  "ParameterKey=CostProfile,ParameterValue=${COST_PROFILE}"
  "ParameterKey=InstanceType,ParameterValue=${INSTANCE_TYPE:-t3.medium}"
  "ParameterKey=DbInstanceClass,ParameterValue=${DB_INSTANCE_CLASS:-db.t4g.micro}"
)

if [[ -n "${TS_AUTHKEY:-}" ]]; then
  PARAMS+=("ParameterKey=TailscaleAuthKey,ParameterValue=${TS_AUTHKEY}")
fi

aws cloudformation validate-template \
  --region "${REGION}" \
  --template-body "file://${TEMPLATE}" >/dev/null

if aws cloudformation describe-stacks --region "${REGION}" --stack-name "${STACK_NAME}" >/dev/null 2>&1; then
  ACTION=update-stack
  WAIT=stack-update-complete
else
  ACTION=create-stack
  WAIT=stack-create-complete
fi

echo "Running ${ACTION} (profile=${COST_PROFILE})..."
set +e
OUT=$(aws cloudformation "${ACTION}" \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --template-body "file://${TEMPLATE}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters "${PARAMS[@]}" \
  --tags \
    Key=Project,Value=mike-regulated \
    Key=Compliance,Value=HIPAA-ITAR-commercial-mvp \
    Key=CostProfile,Value="${COST_PROFILE}" \
    Key=Environment,Value="${ENV_NAME}" \
  2>&1)
RC=$?
set -e

if [[ $RC -ne 0 ]]; then
  if echo "${OUT}" | grep -qi "No updates are to be performed"; then
    echo "No stack updates required."
  else
    echo "${OUT}" >&2
    exit $RC
  fi
else
  if [[ "${COST_PROFILE}" == "standard" ]]; then
    echo "Waiting for ${WAIT} (RDS can take 15–25 minutes)..."
  else
    echo "Waiting for ${WAIT} (MVP usually ~3–8 minutes)..."
  fi
  aws cloudformation wait "${WAIT}" --region "${REGION}" --stack-name "${STACK_NAME}"
fi

echo ""
echo "=== Stack outputs ==="
aws cloudformation describe-stacks \
  --region "${REGION}" \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
  --output table

echo ""
echo "Next:"
echo "  1. Put Mantle key into secret mike-regulated/${ENV_NAME}/mantle"
echo "  2. Tailscale join (if not via TS_AUTHKEY)"
echo "  3. App deploy on branch regulated/aws-native"
echo "See infra/mike-regulated/docs/COST.md for profile tradeoffs."

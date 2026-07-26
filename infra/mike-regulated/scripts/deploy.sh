#!/usr/bin/env bash
# Deploy / update the mike-regulated CloudFormation stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK_NAME="${STACK_NAME:-mike-regulated}"
REGION="${AWS_REGION:-us-east-1}"
TEMPLATE="${ROOT}/cfn/mike-regulated.yaml"
ENV_NAME="${ENVIRONMENT_NAME:-prod}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account=${ACCOUNT} Region=${REGION} Stack=${STACK_NAME}"

if [[ "${ACCOUNT}" != "547519647117" ]]; then
  echo "WARNING: expected Privus account 547519647117, got ${ACCOUNT}" >&2
  read -r -p "Continue anyway? [y/N] " ans
  [[ "${ans:-}" == "y" || "${ans:-}" == "Y" ]] || exit 1
fi

PARAMS=(
  "ParameterKey=EnvironmentName,ParameterValue=${ENV_NAME}"
  "ParameterKey=InstanceType,ParameterValue=${INSTANCE_TYPE:-t3.large}"
  "ParameterKey=DbInstanceClass,ParameterValue=${DB_INSTANCE_CLASS:-db.t4g.medium}"
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

echo "Running ${ACTION}..."
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
  echo "Waiting for ${WAIT} (this can take 15–25 minutes for RDS)..."
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
echo "  1. Set Mantle key: aws secretsmanager put-secret-value --secret-id mike-regulated/${ENV_NAME}/mantle --secret-string file://mantle.json"
echo "  2. Join Tailscale on the instance if not done via user-data"
echo "  3. Continue app deploy on branch regulated/aws-native"
echo ""
echo "Compliance: do not load real PHI/ITAR data until boundary review is complete."

#!/usr/bin/env bash
# Tear down mike-regulated stack. RDS has DeletionProtection=true — disable first if needed.
set -euo pipefail

STACK_NAME="${STACK_NAME:-mike-regulated}"
REGION="${AWS_REGION:-us-east-1}"

echo "This will DELETE stack ${STACK_NAME} in ${REGION}."
echo "RDS deletion protection is ON; destroy may fail until you disable it."
read -r -p "Type 'destroy-mike-regulated' to continue: " confirm
[[ "${confirm}" == "destroy-mike-regulated" ]] || { echo "Aborted."; exit 1; }

# Empty versioned buckets before delete
for key in DocsBucketName LogsBucketName; do
  bucket=$(aws cloudformation describe-stacks --region "${REGION}" --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" --output text 2>/dev/null || true)
  if [[ -n "${bucket}" && "${bucket}" != "None" ]]; then
    echo "Emptying s3://${bucket} ..."
    aws s3 rm "s3://${bucket}" --recursive || true
  fi
done

# Disable RDS deletion protection
db_id=$(aws rds describe-db-instances --region "${REGION}" \
  --query "DBInstances[?contains(DBInstanceIdentifier, 'mike-regulated')].DBInstanceIdentifier | [0]" \
  --output text 2>/dev/null || true)
if [[ -n "${db_id}" && "${db_id}" != "None" ]]; then
  echo "Disabling deletion protection on ${db_id}..."
  aws rds modify-db-instance --region "${REGION}" \
    --db-instance-identifier "${db_id}" \
    --no-deletion-protection --apply-immediately || true
  sleep 15
fi

aws cloudformation delete-stack --region "${REGION}" --stack-name "${STACK_NAME}"
echo "Waiting for delete..."
aws cloudformation wait stack-delete-complete --region "${REGION}" --stack-name "${STACK_NAME}"
echo "Deleted."

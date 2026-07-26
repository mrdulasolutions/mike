# Mike regulated AWS workspace

Infrastructure for a **private, HIPAA-aware, ITAR-conscious commercial** deploy of Mike.

| Item | Value |
|------|--------|
| Stack name | `mike-regulated` |
| Region | `us-east-1` |
| Access | Tailscale only |
| Data | RDS + S3 + Cognito + KMS |

See [docs/COMPLIANCE-BOUNDARY.md](./docs/COMPLIANCE-BOUNDARY.md).

## Prerequisites

- AWS CLI authenticated to account `547519647117`
- Permissions to create VPC, EC2, RDS, S3, KMS, Cognito, IAM, Secrets Manager
- Tailscale auth key (reusable, tagged) for the instance

## Deploy (Phase 1)

```bash
# From repo root
export AWS_REGION=us-east-1
export TS_AUTHKEY='tskey-auth-...'   # optional at create; can join later

./infra/mike-regulated/scripts/deploy.sh
```

The script:

1. Creates/updates CloudFormation stack `mike-regulated`
2. Prints outputs (VPC, RDS endpoint, bucket, Cognito IDs, EC2 instance id)
3. Does **not** deploy the Mike app containers (Phase 2–3)

## Destroy (careful)

```bash
./infra/mike-regulated/scripts/destroy.sh
```

RDS deletion policy is `Snapshot` by default.

## Cost (order of magnitude)

- NAT Gateway (~$32+/mo) + EC2 t3.large + RDS db.t4g.medium + S3/KMS  
- Expect **low hundreds USD/month** depending on traffic and size.

## App configuration (after stack)

See `backend/.env.regulated.example` on branch `regulated/aws-native`.

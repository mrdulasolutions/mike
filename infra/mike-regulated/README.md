# Mike regulated AWS workspace

Infrastructure for a **private, HIPAA-aware, ITAR-conscious commercial** deploy of Mike.

| Item | Value |
|------|--------|
| Stack name | `mike-regulated` |
| Region | `us-east-1` |
| Access | Tailscale only |
| Default cost profile | **`mvp`** (~$30–60/mo) |

See [docs/COMPLIANCE-BOUNDARY.md](./docs/COMPLIANCE-BOUNDARY.md) and **[docs/COST.md](./docs/COST.md)**.

## Prerequisites

- AWS CLI authenticated to account `547519647117`
- Permissions to create VPC, EC2, S3, KMS, Cognito, IAM, Secrets Manager  
  (RDS only if `COST_PROFILE=standard`)
- Optional Tailscale auth key for the instance

## Deploy cheap MVP (default)

```bash
export AWS_REGION=us-east-1
export COST_PROFILE=mvp              # default — no NAT, no RDS
export INSTANCE_TYPE=t3.medium       # or t3.small
# export TS_AUTHKEY='tskey-auth-...' # optional
./infra/mike-regulated/scripts/deploy.sh
```

**MVP includes:** dedicated VPC, small EC2, Docker Postgres on-box, S3 (KMS), Cognito MFA, Secrets Manager.  
**MVP skips:** NAT Gateway (~$32+/mo) and managed RDS.

## Deploy standard (later)

```bash
export COST_PROFILE=standard
export DB_INSTANCE_CLASS=db.t4g.micro
./infra/mike-regulated/scripts/deploy.sh
```

## Destroy (careful)

```bash
./infra/mike-regulated/scripts/destroy.sh
```

## App configuration (after stack)

See `backend/.env.regulated.example` on branch `regulated/aws-native`.

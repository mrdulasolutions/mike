# Cost profiles

## `mvp` (default) — cheapest

| Resource | MVP choice | Approx. |
|----------|------------|---------|
| NAT Gateway | **None** | **saves ~$32–45/mo** |
| RDS | **None** — Postgres 16 in Docker on the EC2 host | **saves ~$15–50+/mo** |
| EC2 | `t3.medium` (default), 30 GB gp3 encrypted | ~$25–35/mo |
| S3 + KMS + Secrets + Cognito + flow logs | Minimal | few $/mo |
| **Ballpark total** | | **~$30–60/mo** |

### Tradeoffs (acceptable for regulated *build* / internal MVP)

- Postgres is **not** Multi-AZ managed RDS — backups are EBS snapshots + your dump job.
- EC2 sits in a **public subnet** for outbound (Mantle/Tailscale) but **security group allows no public app ingress**.
- Single host = single failure domain.

### Still keep for compliance posture

- Dedicated VPC (isolated from Open WebUI)
- Encrypted EBS + S3 SSE-KMS
- Cognito MFA
- No public 80/443 listeners (Tailscale only)
- HIPAA BAA account + eligible services for AWS-side data

## `standard` — production-shaped

| Add-on | Approx. |
|--------|---------|
| NAT Gateway | +$32–45/mo |
| RDS `db.t4g.micro`–`medium` | +$15–60/mo |
| Private subnets | — |
| **Ballpark total** | **~$120–200+/mo** |

## Deploy MVP

```bash
export AWS_REGION=us-east-1
export COST_PROFILE=mvp          # default
export INSTANCE_TYPE=t3.medium   # or t3.small to go lower
# optional: export TS_AUTHKEY=tskey-auth-...
./infra/mike-regulated/scripts/deploy.sh
```

## Scale up later

```bash
export COST_PROFILE=standard
export DB_INSTANCE_CLASS=db.t4g.small
./infra/mike-regulated/scripts/deploy.sh
```

Note: moving from MVP → standard may **replace** the app subnet layout; plan a maintenance window and DB dump/restore from local Postgres → RDS.

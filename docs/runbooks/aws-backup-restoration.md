# Restore an AWS Backup

Use this runbook to prove that an RDS recovery point can create an isolated
database. Never replace the production database during a drill.

## Prerequisites

- authorized AWS CLI session
- backup vault name
- isolated data subnet group and database security group
- a unique restore identifier
- enough quota and approved temporary spend

## Start the restore

```bash
RECOVERY_POINT_ARN="$(
  aws backup list-recovery-points-by-backup-vault \
    --backup-vault-name "$BACKUP_VAULT" \
    --by-resource-type RDS \
    --query 'sort_by(RecoveryPoints,&CreationDate)[-1].RecoveryPointArn' \
    --output text
)"
ROLE_ARN="$(
  aws iam get-role \
    --role-name "$BACKUP_RESTORE_ROLE" \
    --query 'Role.Arn' \
    --output text
)"
aws backup start-restore-job \
  --recovery-point-arn "$RECOVERY_POINT_ARN" \
  --iam-role-arn "$ROLE_ARN" \
  --metadata \
    "DBInstanceIdentifier=$RESTORE_IDENTIFIER,DBSubnetGroupName=$DATA_SUBNET_GROUP,VpcSecurityGroupIds=$DATABASE_SECURITY_GROUP,MultiAZ=false,PubliclyAccessible=false"
```

Poll `aws backup describe-restore-job --restore-job-id "$RESTORE_JOB_ID"` until
the job reaches `COMPLETED`. Stop on `ABORTED` or `FAILED`.

Connect from an isolated one-off ECS task. Run `prisma migrate status`, count
synthetic reference records, and verify schema constraints without sending
email, payment, or webhook traffic. Do not attach production services.

Delete the restored database after retaining the recovery point ARN, restore job
ID, duration, checks, and UTC times. Retain no query results, credentials, or
private endpoints.

locals {
  common_tags = merge(var.tags, { Component = "data" })
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_iam_policy_document" "kms" {
  statement {
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${data.aws_region.current.region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_key" "this" {
  description             = "Encrypt ${var.name} application data"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms.json
  tags                    = local.common_tags
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.this.key_id
}

resource "aws_security_group" "database" {
  name_prefix = "${var.name}-database-"
  description = "Allow PostgreSQL from application tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from application tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.application_security_group_id]
  }

  tags = local.common_tags
}

resource "aws_db_subnet_group" "this" {
  name_prefix = "${var.name}-"
  subnet_ids  = var.data_subnet_ids
  tags        = local.common_tags
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name}-"
  family      = "postgres17"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = local.common_tags
}

resource "aws_db_instance" "this" {
  identifier_prefix = "${var.name}-"

  allocated_storage                   = 20
  allow_major_version_upgrade         = false
  auto_minor_version_upgrade          = true
  backup_retention_period             = 7
  backup_window                       = "03:00-04:00"
  copy_tags_to_snapshot               = true
  db_name                             = "event_ticketing"
  db_subnet_group_name                = aws_db_subnet_group.this.name
  deletion_protection                 = var.deletion_protection
  engine                              = "postgres"
  engine_version                      = "17.5"
  final_snapshot_identifier           = "${var.name}-final"
  iam_database_authentication_enabled = true
  instance_class                      = var.rds_instance_class
  kms_key_id                          = aws_kms_key.this.arn
  maintenance_window                  = "sun:05:00-sun:06:00"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = aws_kms_key.this.arn
  multi_az                            = true
  parameter_group_name                = aws_db_parameter_group.this.name
  performance_insights_enabled        = true
  publicly_accessible                 = false
  skip_final_snapshot                 = false
  storage_encrypted                   = true
  storage_type                        = "gp3"
  username                            = "platform_admin"
  vpc_security_group_ids              = [aws_security_group.database.id]

  tags = local.common_tags
}

resource "aws_security_group" "redis" {
  name_prefix = "${var.name}-redis-"
  description = "Allow Redis from application tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from application tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.application_security_group_id]
  }

  tags = local.common_tags
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.data_subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.name
  description          = "${var.name} waiting room and queue acceleration"

  apply_immediately          = false
  at_rest_encryption_enabled = true
  automatic_failover_enabled = true
  engine                     = "valkey"
  engine_version             = "8.0"
  kms_key_id                 = aws_kms_key.this.arn
  multi_az_enabled           = true
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  port                       = 6379
  snapshot_retention_limit   = 7
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  transit_encryption_enabled = true
  security_group_ids         = [aws_security_group.redis.id]

  tags = local.common_tags
}

resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "${var.name}-artifacts-"
  force_destroy = false
  tags          = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.this.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  depends_on = [aws_s3_bucket_versioning.artifacts]
}

resource "aws_secretsmanager_secret" "application" {
  name_prefix             = "${var.name}/application-"
  description             = "Runtime application configuration populated outside Terraform"
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = 30
  tags                    = local.common_tags
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name_prefix        = "${var.name}-backup-"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
    "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup",
    "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Restore",
  ])

  policy_arn = each.value
  role       = aws_iam_role.backup.name
}

resource "aws_backup_vault" "this" {
  name          = var.name
  kms_key_arn   = aws_kms_key.this.arn
  force_destroy = !var.deletion_protection
  tags          = local.common_tags
}

resource "aws_backup_vault_lock_configuration" "this" {
  count = var.deletion_protection ? 1 : 0

  backup_vault_name  = aws_backup_vault.this.name
  min_retention_days = var.backup_retention_days
  max_retention_days = 365
}

resource "aws_backup_plan" "this" {
  name = var.name

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.this.name
    schedule          = "cron(0 5 * * ? *)"

    lifecycle {
      delete_after = var.backup_retention_days
    }
  }

  tags = local.common_tags
}

resource "aws_backup_selection" "this" {
  iam_role_arn = aws_iam_role.backup.arn
  name         = var.name
  plan_id      = aws_backup_plan.this.id
  resources = [
    aws_db_instance.this.arn,
    aws_s3_bucket.artifacts.arn,
  ]

  depends_on = [aws_iam_role_policy_attachment.backup]
}

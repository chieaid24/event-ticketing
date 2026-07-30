output "application_secret_arn" {
  value = aws_secretsmanager_secret.application.arn
}

output "artifact_bucket_arn" {
  value = aws_s3_bucket.artifacts.arn
}

output "artifact_bucket_name" {
  value = aws_s3_bucket.artifacts.id
}

output "database_endpoint" {
  value = aws_db_instance.this.address
}

output "database_master_secret_arn" {
  value     = aws_db_instance.this.master_user_secret[0].secret_arn
  sensitive = true
}

output "kms_key_arn" {
  value = aws_kms_key.this.arn
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

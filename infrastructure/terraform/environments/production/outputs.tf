output "api_cloudfront_domain_name" {
  value = module.platform.api_cloudfront_domain_name
}

output "application_secret_arn" {
  value = module.data.application_secret_arn
}

output "cloudfront_domain_name" {
  value = module.platform.cloudfront_domain_name
}

output "database_master_secret_arn" {
  value     = module.data.database_master_secret_arn
  sensitive = true
}

output "deployment_role_arn" {
  value = module.platform.deployment_role_arn
}

output "ecs_cluster_name" {
  value = module.platform.ecs_cluster_name
}

output "ecs_service_names" {
  value = module.platform.ecs_service_names
}

output "api_cloudfront_domain_name" {
  value = aws_cloudfront_distribution.api.domain_name
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "deployment_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ecs_service_names" {
  value = {
    for name, service in aws_ecs_service.this : name => service.name
  }
}

output "task_definition_families" {
  value = {
    for name, definition in aws_ecs_task_definition.this : name => definition.family
  }
}

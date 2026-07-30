output "build_role_arn" {
  value = aws_iam_role.build.arn
}

output "ecr_repository_name" {
  value = aws_ecr_repository.this.name
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

variable "application_secret_arn" {
  description = "Secrets Manager secret containing runtime JSON keys."
  type        = string
}

variable "application_security_group_id" {
  description = "Security group attached to ECS tasks."
  type        = string
}

variable "application_subnet_ids" {
  description = "Private subnet IDs for ECS tasks."
  type        = list(string)
}

variable "api_origin" {
  description = "Public HTTPS API origin used by the web application."
  type        = string
}

variable "artifact_bucket_arn" {
  description = "ARN of the private application artifact bucket."
  type        = string
}

variable "artifact_bucket_name" {
  description = "Name of the private application artifact bucket."
  type        = string
}

variable "desired_count" {
  description = "Desired task count for each service."
  type        = number
  default     = 2
}

variable "github_environment" {
  description = "GitHub environment allowed to assume the deployment role."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "ARN of the account GitHub Actions OIDC provider."
  type        = string
}

variable "github_repository" {
  description = "GitHub owner and repository."
  type        = string
}

variable "image_uri" {
  description = "Immutable ECR image URI including a sha256 digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must use an immutable sha256 digest."
  }
}

variable "kms_key_arn" {
  description = "KMS key used by application data and secrets."
  type        = string
}

variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "public_origin" {
  description = "Public HTTPS web origin used by API CORS and email links."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the load balancer."
  type        = list(string)
}

variable "redis_endpoint" {
  description = "Private ElastiCache primary endpoint."
  type        = string
}

variable "tags" {
  description = "Tags applied to every supported resource."
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  description = "VPC containing the platform."
  type        = string
}

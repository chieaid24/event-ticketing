variable "aws_region" {
  description = "AWS region for the shared ECR repository."
  type        = string
  default     = "us-east-1"
}

variable "github_repository" {
  description = "GitHub owner and repository allowed to publish images."
  type        = string
  default     = "chieaid24/event-ticketing"
}

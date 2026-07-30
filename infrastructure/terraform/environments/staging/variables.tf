variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "api_origin" {
  type = string
}

variable "github_oidc_provider_arn" {
  type = string
}

variable "github_repository" {
  type    = string
  default = "chieaid24/event-ticketing"
}

variable "image_uri" {
  type = string
}

variable "public_origin" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

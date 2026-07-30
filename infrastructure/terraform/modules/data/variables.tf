variable "application_security_group_id" {
  description = "Security group allowed to reach PostgreSQL and Redis."
  type        = string
}

variable "backup_retention_days" {
  description = "Days to retain daily AWS Backup recovery points."
  type        = number
  default     = 35
}

variable "data_subnet_ids" {
  description = "Private subnet IDs for stateful services."
  type        = list(string)
}

variable "deletion_protection" {
  description = "Protect the database and backup vault from deletion."
  type        = bool
  default     = true
}

variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "redis_node_type" {
  description = "ElastiCache node class."
  type        = string
}

variable "rds_instance_class" {
  description = "RDS instance class."
  type        = string
}

variable "tags" {
  description = "Tags applied to every supported resource."
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  description = "VPC containing the data tier."
  type        = string
}

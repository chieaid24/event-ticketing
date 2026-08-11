variable "backup_retention_days" {
  description = "Days to retain automated PostgreSQL backups."
  type        = number
  default     = 35
}

variable "database_subnet_id" {
  description = "Delegated subnet for the PostgreSQL flexible server."
  type        = string
}

variable "deletion_protection" {
  description = "Protect the database and artifact storage from deletion."
  type        = bool
  default     = true
}

variable "location" {
  description = "Azure region for data resources."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Workspace receiving data-tier diagnostics."
  type        = string
}

variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "postgres_private_dns_zone_id" {
  description = "Private DNS zone for the PostgreSQL flexible server."
  type        = string
}

variable "postgres_sku_name" {
  description = "PostgreSQL flexible server compute SKU."
  type        = string
}

variable "private_dns_zone_ids" {
  description = "Private DNS zone IDs keyed by blob, redis, and vault."
  type        = map(string)
}

variable "private_endpoints_subnet_id" {
  description = "Subnet hosting the data-tier private endpoints."
  type        = string
}

variable "redis_sku_name" {
  description = "Azure Managed Redis SKU."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group containing the data tier."
  type        = string
}

variable "tags" {
  description = "Tags applied to every supported resource."
  type        = map(string)
  default     = {}
}

variable "api_origin" {
  description = "Public HTTPS API origin used by the web application."
  type        = string
}

variable "container_apps_subnet_id" {
  description = "Delegated subnet hosting the container apps environment."
  type        = string
}

variable "container_registry_id" {
  description = "Shared container registry granted AcrPull for the application identity."
  type        = string
}

variable "desired_count" {
  description = "Minimum replica count for the web and api container apps."
  type        = number
  default     = 2
}

variable "image_uri" {
  description = "Immutable registry image URI including a sha256 digest."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must use an immutable sha256 digest."
  }
}

variable "key_vault_id" {
  description = "Key vault holding runtime application secrets."
  type        = string
}

variable "key_vault_uri" {
  description = "Vault URI used to build key vault secret references."
  type        = string
}

variable "location" {
  description = "Azure region for platform resources."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Workspace receiving container apps and Front Door telemetry."
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

variable "resource_group_name" {
  description = "Resource group containing the platform."
  type        = string
}

variable "storage_account_id" {
  description = "Artifact storage account granted to the application identity."
  type        = string
}

variable "tags" {
  description = "Tags applied to every supported resource."
  type        = map(string)
  default     = {}
}

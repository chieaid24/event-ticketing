variable "deployment_scopes" {
  description = "Environment resource group IDs granted to the matching deploy identity."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for environment in keys(var.deployment_scopes) :
      contains(["staging", "production"], environment)
    ])
    error_message = "deployment_scopes keys must be staging or production."
  }
}

variable "registry_name" {
  description = "Globally unique Azure Container Registry name (5-50 alphanumeric characters)."
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z0-9]{5,50}$", var.registry_name))
    error_message = "registry_name must be 5-50 alphanumeric characters and globally unique across Azure."
  }
}

variable "github_repository" {
  description = "GitHub owner and repository allowed to publish and deploy images."
  type        = string
  default     = "chieaid24/event-ticketing"
}

variable "location" {
  description = "Azure region for shared delivery resources."
  type        = string
  default     = "eastus2"
}

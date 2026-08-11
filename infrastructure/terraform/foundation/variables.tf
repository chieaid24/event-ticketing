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

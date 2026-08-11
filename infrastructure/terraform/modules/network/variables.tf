variable "location" {
  description = "Azure region for network resources."
  type        = string
}

variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group containing the network."
  type        = string
}

variable "tags" {
  description = "Tags applied to every supported resource."
  type        = map(string)
  default     = {}
}

variable "vnet_cidr" {
  description = "CIDR block for the virtual network."
  type        = string
}

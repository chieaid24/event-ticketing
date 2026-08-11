variable "api_origin" {
  type = string
}

variable "container_registry_id" {
  type = string
}

variable "image_uri" {
  type = string
}

variable "location" {
  type    = string
  default = "eastus2"
}

variable "public_origin" {
  type = string
}

variable "vnet_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

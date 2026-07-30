variable "availability_zone_count" {
  description = "Number of availability zones used by each subnet tier."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2
    error_message = "Use at least two availability zones."
  }
}

variable "name" {
  description = "Resource name prefix."
  type        = string
}

variable "tags" {
  description = "Tags applied to every supported resource."
  type        = map(string)
  default     = {}
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
}

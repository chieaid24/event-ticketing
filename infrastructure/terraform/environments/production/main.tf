locals {
  name = "event-ticketing-production"
  tags = {
    Environment = "production"
    ManagedBy   = "terraform"
    Project     = "event-ticketing"
  }
}

module "network" {
  source = "../../modules/network"

  name     = local.name
  tags     = local.tags
  vpc_cidr = var.vpc_cidr
}

module "data" {
  source = "../../modules/data"

  application_security_group_id = module.network.application_security_group_id
  backup_retention_days         = 35
  data_subnet_ids               = module.network.data_subnet_ids
  deletion_protection           = true
  name                          = local.name
  rds_instance_class            = "db.r7g.large"
  redis_node_type               = "cache.r7g.large"
  tags                          = local.tags
  vpc_id                        = module.network.vpc_id
}

module "platform" {
  source = "../../modules/platform"

  application_secret_arn        = module.data.application_secret_arn
  application_security_group_id = module.network.application_security_group_id
  application_subnet_ids        = module.network.application_subnet_ids
  api_origin                    = var.api_origin
  artifact_bucket_arn           = module.data.artifact_bucket_arn
  artifact_bucket_name          = module.data.artifact_bucket_name
  desired_count                 = 3
  github_environment            = "production"
  github_oidc_provider_arn      = var.github_oidc_provider_arn
  github_repository             = var.github_repository
  image_uri                     = var.image_uri
  kms_key_arn                   = module.data.kms_key_arn
  name                          = local.name
  public_origin                 = var.public_origin
  public_subnet_ids             = module.network.public_subnet_ids
  redis_endpoint                = module.data.redis_endpoint
  tags                          = local.tags
  vpc_id                        = module.network.vpc_id
}

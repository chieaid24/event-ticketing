locals {
  name = "event-ticketing-production"
  tags = {
    Environment = "production"
    ManagedBy   = "terraform"
    Project     = "event-ticketing"
  }
}

resource "azurerm_resource_group" "this" {
  name     = local.name
  location = var.location
  tags     = local.tags
}

resource "azurerm_log_analytics_workspace" "this" {
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

module "network" {
  source = "../../modules/network"

  location            = azurerm_resource_group.this.location
  name                = local.name
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
  vnet_cidr           = var.vnet_cidr
}

module "data" {
  source = "../../modules/data"

  backup_retention_days        = 35
  database_subnet_id           = module.network.database_subnet_id
  deletion_protection          = true
  location                     = azurerm_resource_group.this.location
  log_analytics_workspace_id   = azurerm_log_analytics_workspace.this.id
  name                         = local.name
  postgres_private_dns_zone_id = module.network.postgres_private_dns_zone_id
  postgres_sku_name            = "GP_Standard_D4ds_v5"
  private_dns_zone_ids         = module.network.private_dns_zone_ids
  private_endpoints_subnet_id  = module.network.private_endpoints_subnet_id
  redis_sku_name               = "Balanced_B10"
  resource_group_name          = azurerm_resource_group.this.name
  tags                         = local.tags
}

module "platform" {
  source = "../../modules/platform"

  api_origin                 = var.api_origin
  container_apps_subnet_id   = module.network.container_apps_subnet_id
  container_registry_id      = var.container_registry_id
  desired_count              = 3
  image_uri                  = var.image_uri
  key_vault_id               = module.data.key_vault_id
  key_vault_uri              = module.data.key_vault_uri
  location                   = azurerm_resource_group.this.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  name                       = local.name
  public_origin              = var.public_origin
  resource_group_name        = azurerm_resource_group.this.name
  storage_account_id         = module.data.storage_account_id
  tags                       = local.tags
}

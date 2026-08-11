locals {
  common_tags = merge(var.tags, { Component = "data" })

  # Storage account and vault names allow at most 24 characters.
  compact_name = substr(replace(var.name, "-", ""), 0, 18)
}

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 6
  lower   = true
  numeric = true
  special = false
  upper   = false
}

resource "random_password" "postgres_admin" {
  length      = 32
  special     = false
  min_lower   = 1
  min_numeric = 1
  min_upper   = 1
}

resource "azurerm_key_vault" "this" {
  name                = "${local.compact_name}${random_string.suffix.result}"
  resource_group_name = var.resource_group_name
  location            = var.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  purge_protection_enabled      = true
  public_network_access_enabled = false
  rbac_authorization_enabled    = true
  soft_delete_retention_days    = 90

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  tags = local.common_tags
}

resource "azurerm_role_assignment" "terraform_secrets_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_private_endpoint" "key_vault" {
  name                = "${var.name}-vault"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoints_subnet_id
  tags                = local.common_tags

  private_service_connection {
    name                           = "${var.name}-vault"
    private_connection_resource_id = azurerm_key_vault.this.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_ids["vault"]]
  }
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location

  version                       = "17"
  sku_name                      = var.postgres_sku_name
  storage_mb                    = 32768
  auto_grow_enabled             = true
  backup_retention_days         = var.backup_retention_days
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = false
  delegated_subnet_id           = var.database_subnet_id
  private_dns_zone_id           = var.postgres_private_dns_zone_id
  zone                          = "1"

  administrator_login    = "platform_admin"
  administrator_password = random_password.postgres_admin.result

  high_availability {
    mode                      = "ZoneRedundant"
    standby_availability_zone = "2"
  }

  maintenance_window {
    day_of_week  = 0
    start_hour   = 5
    start_minute = 0
  }

  tags = local.common_tags
}

# Built-in PgBouncer keeps connection counts stable while container apps scale.
resource "azurerm_postgresql_flexible_server_configuration" "pgbouncer" {
  name      = "pgbouncer.enabled"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "true"
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = "event_ticketing"
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_key_vault_secret" "postgres_admin_password" {
  name         = "postgres-admin-password"
  value        = random_password.postgres_admin.result
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_managed_redis" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku_name            = var.redis_sku_name

  high_availability_enabled = true
  public_network_access     = "Disabled"

  default_database {
    access_keys_authentication_enabled = true
    client_protocol                    = "Encrypted"
    clustering_policy                  = "EnterpriseCluster"
    eviction_policy                    = "NoEviction"
  }

  tags = local.common_tags
}

resource "azurerm_private_endpoint" "redis" {
  name                = "${var.name}-redis"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoints_subnet_id
  tags                = local.common_tags

  private_service_connection {
    name                           = "${var.name}-redis"
    private_connection_resource_id = azurerm_managed_redis.this.id
    subresource_names              = ["redisEnterprise"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_ids["redis"]]
  }
}

resource "azurerm_key_vault_secret" "redis_url" {
  name         = "redis-url"
  value        = "rediss://:${azurerm_managed_redis.this.default_database[0].primary_access_key}@${azurerm_managed_redis.this.hostname}:${azurerm_managed_redis.this.default_database[0].port}"
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.terraform_secrets_officer]
}

resource "azurerm_storage_account" "artifacts" {
  name                = "${local.compact_name}${random_string.suffix.result}"
  resource_group_name = var.resource_group_name
  location            = var.location

  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = "ZRS"

  allow_nested_items_to_be_public = false
  https_traffic_only_enabled      = true
  min_tls_version                 = "TLS1_2"
  public_network_access_enabled   = false
  shared_access_key_enabled       = false

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  tags = local.common_tags
}

resource "azurerm_storage_container" "artifacts" {
  name                  = "artifacts"
  storage_account_id    = azurerm_storage_account.artifacts.id
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "artifacts" {
  storage_account_id = azurerm_storage_account.artifacts.id

  rule {
    name    = "expire-noncurrent-versions"
    enabled = true

    filters {
      blob_types = ["blockBlob"]
    }

    actions {
      version {
        delete_after_days_since_creation = 90
      }
    }
  }
}

resource "azurerm_private_endpoint" "blob" {
  name                = "${var.name}-blob"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoints_subnet_id
  tags                = local.common_tags

  private_service_connection {
    name                           = "${var.name}-blob"
    private_connection_resource_id = azurerm_storage_account.artifacts.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_ids["blob"]]
  }
}

resource "azurerm_monitor_diagnostic_setting" "postgres" {
  name                       = "${var.name}-postgres"
  target_resource_id         = azurerm_postgresql_flexible_server.this.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category_group = "allLogs"
  }
}

resource "azurerm_management_lock" "database" {
  count = var.deletion_protection ? 1 : 0

  name       = "${var.name}-database"
  scope      = azurerm_postgresql_flexible_server.this.id
  lock_level = "CanNotDelete"
  notes      = "Authoritative inventory and order store."
}

resource "azurerm_management_lock" "artifacts" {
  count = var.deletion_protection ? 1 : 0

  name       = "${var.name}-artifacts"
  scope      = azurerm_storage_account.artifacts.id
  lock_level = "CanNotDelete"
  notes      = "Versioned application artifact store."
}

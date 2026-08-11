output "artifact_container_name" {
  value = azurerm_storage_container.artifacts.name
}

output "database_fqdn" {
  value = azurerm_postgresql_flexible_server.this.fqdn
}

output "database_server_id" {
  value = azurerm_postgresql_flexible_server.this.id
}

output "key_vault_id" {
  value = azurerm_key_vault.this.id
}

output "key_vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "redis_hostname" {
  value = azurerm_managed_redis.this.hostname
}

output "storage_account_id" {
  value = azurerm_storage_account.artifacts.id
}

output "storage_account_name" {
  value = azurerm_storage_account.artifacts.name
}

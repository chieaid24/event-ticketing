output "build_identity_client_id" {
  value = azurerm_user_assigned_identity.github["build"].client_id
}

output "container_registry_id" {
  value = azurerm_container_registry.this.id
}

output "container_registry_login_server" {
  value = azurerm_container_registry.this.login_server
}

output "deploy_identity_client_ids" {
  value = {
    production = azurerm_user_assigned_identity.github["deploy-production"].client_id
    staging    = azurerm_user_assigned_identity.github["deploy-staging"].client_id
  }
}

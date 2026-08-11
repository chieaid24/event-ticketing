output "api_front_door_hostname" {
  value = azurerm_cdn_frontdoor_endpoint.api.host_name
}

output "application_identity_client_id" {
  value = azurerm_user_assigned_identity.application.client_id
}

output "container_app_environment_id" {
  value = azurerm_container_app_environment.this.id
}

output "container_app_names" {
  value = {
    for name, app in azurerm_container_app.this : name => app.name
  }
}

output "migrate_job_name" {
  value = azurerm_container_app_job.migrate.name
}

output "web_front_door_hostname" {
  value = azurerm_cdn_frontdoor_endpoint.web.host_name
}

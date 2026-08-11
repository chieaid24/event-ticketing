output "api_front_door_hostname" {
  value = module.platform.api_front_door_hostname
}

output "container_app_environment_id" {
  value = module.platform.container_app_environment_id
}

output "container_app_names" {
  value = module.platform.container_app_names
}

output "database_fqdn" {
  value = module.data.database_fqdn
}

output "key_vault_uri" {
  value = module.data.key_vault_uri
}

output "migrate_job_name" {
  value = module.platform.migrate_job_name
}

output "web_front_door_hostname" {
  value = module.platform.web_front_door_hostname
}

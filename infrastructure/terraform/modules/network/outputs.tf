output "container_apps_subnet_id" {
  value = azurerm_subnet.container_apps.id
}

output "database_subnet_id" {
  value = azurerm_subnet.database.id
}

output "postgres_private_dns_zone_id" {
  value = azurerm_private_dns_zone.postgres.id
}

output "private_dns_zone_ids" {
  value = {
    for key, zone in azurerm_private_dns_zone.private_link : key => zone.id
  }
}

output "private_endpoints_subnet_id" {
  value = azurerm_subnet.private_endpoints.id
}

output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

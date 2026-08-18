locals {
  tags = {
    Component   = "delivery"
    Environment = "shared"
    ManagedBy   = "terraform"
    Project     = "event-ticketing"
  }

  github_identities = {
    build = {
      subject = "repo:${var.github_repository}:ref:refs/heads/main"
    }
    deploy-staging = {
      subject = "repo:${var.github_repository}:environment:staging"
    }
    deploy-production = {
      subject = "repo:${var.github_repository}:environment:production"
    }
  }
}

resource "azurerm_resource_group" "delivery" {
  name     = "event-ticketing-delivery"
  location = var.location
  tags     = local.tags
}

# ACR has no registry-wide tag immutability switch; promotion is immutable
# because every environment pins image_uri to a sha256 digest.
resource "azurerm_container_registry" "this" {
  name                = var.registry_name
  resource_group_name = azurerm_resource_group.delivery.name
  location            = azurerm_resource_group.delivery.location
  sku                 = "Premium"

  admin_enabled            = false
  anonymous_pull_enabled   = false
  retention_policy_in_days = 7
  zone_redundancy_enabled  = true

  tags = local.tags
}

resource "azurerm_user_assigned_identity" "github" {
  for_each = local.github_identities

  name                = "event-ticketing-${each.key}"
  resource_group_name = azurerm_resource_group.delivery.name
  location            = azurerm_resource_group.delivery.location
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github" {
  for_each = local.github_identities

  name                = "github-${each.key}"
  resource_group_name = azurerm_resource_group.delivery.name
  parent_id           = azurerm_user_assigned_identity.github[each.key].id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = "https://token.actions.githubusercontent.com"
  subject             = each.value.subject
}

resource "azurerm_role_assignment" "build_acr_push" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.github["build"].principal_id
}

resource "azurerm_role_assignment" "deploy" {
  for_each = var.deployment_scopes

  scope                = each.value
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github["deploy-${each.key}"].principal_id
}

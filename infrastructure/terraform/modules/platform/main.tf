locals {
  common_tags = merge(var.tags, { Component = "platform" })

  registry_server = split("/", var.image_uri)[0]

  # Runtime secrets resolve through key vault references; operators populate
  # every value except redis-url, which the data module manages.
  secret_keys = {
    api = [
      "DATABASE_URL",
      "PAYMENT_WEBHOOK_SECRET",
      "REDIS_URL",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_SECRET_KEY",
      "WAITING_ROOM_TOKEN_SECRET",
    ]
    worker = [
      "DATABASE_URL",
      "REDIS_URL",
      "SMTP_URL",
      "STRIPE_SECRET_KEY",
    ]
  }

  secret_names = {
    for key in distinct(flatten(values(local.secret_keys))) :
    key => lower(replace(key, "_", "-"))
  }

  runtime_environment = {
    api = {
      API_COOKIE_SECURE = "true"
      # X-Azure-FDID carries the profile GUID, not the ARM resource ID.
      API_FRONT_DOOR_PROFILE_ID          = azurerm_cdn_frontdoor_profile.this.resource_guid
      API_HOST                           = "0.0.0.0"
      API_PORT                           = "4000"
      API_TRUSTED_ORIGINS                = var.public_origin
      LOG_LEVEL                          = "info"
      PAYMENT_PROVIDER                   = "stripe"
      WAITING_ROOM_ADMISSION_CAPACITY    = "100"
      WAITING_ROOM_HEARTBEAT_TTL_SECONDS = "60"
      WAITING_ROOM_LEASE_TTL_SECONDS     = "300"
      WAITING_ROOM_TOKEN_TTL_SECONDS     = "1800"
    }
    web = {
      API_BASE_URL = var.api_origin
      PORT         = "3000"
    }
    worker = {
      LOG_LEVEL                      = "info"
      MAIL_FROM                      = "Event Ticketing <no-reply@example.test>"
      OPS_ALERT_EMAIL                = "ops@example.test"
      PAYMENT_PROVIDER               = "stripe"
      WEB_BASE_URL                   = var.public_origin
      WORKER_OUTBOX_BATCH_SIZE       = "10"
      WORKER_OUTBOX_LEASE_MS         = "30000"
      WORKER_OUTBOX_POLL_INTERVAL_MS = "1000"
      WORKER_OUTBOX_RETRY_BASE_MS    = "1000"
      WORKER_OUTBOX_RETRY_MAXIMUM_MS = "300000"
      WORKER_SHUTDOWN_TIMEOUT_MS     = "10000"
    }
  }

  services = {
    api = {
      port        = 4000
      health_path = "/health/ready"
    }
    web = {
      port        = 3000
      health_path = "/"
    }
    worker = {
      port        = null
      health_path = null
    }
  }
}

resource "azurerm_user_assigned_identity" "application" {
  name                = "${var.name}-application"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = local.common_tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.container_registry_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.application.principal_id
}

resource "azurerm_role_assignment" "key_vault_secrets" {
  scope                = var.key_vault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.application.principal_id
}

resource "azurerm_role_assignment" "artifacts" {
  scope                = var.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.application.principal_id
}

resource "azurerm_container_app_environment" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location

  infrastructure_subnet_id       = var.container_apps_subnet_id
  internal_load_balancer_enabled = false
  log_analytics_workspace_id     = var.log_analytics_workspace_id
  logs_destination               = "log-analytics"
  zone_redundancy_enabled        = true

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  tags = local.common_tags
}

resource "azurerm_container_app" "this" {
  for_each = local.services

  name                         = each.key
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.application.id]
  }

  registry {
    server   = local.registry_server
    identity = azurerm_user_assigned_identity.application.id
  }

  dynamic "secret" {
    for_each = toset(lookup(local.secret_keys, each.key, []))

    content {
      name                = local.secret_names[secret.value]
      identity            = azurerm_user_assigned_identity.application.id
      key_vault_secret_id = "${var.key_vault_uri}secrets/${local.secret_names[secret.value]}"
    }
  }

  dynamic "ingress" {
    for_each = each.value.port == null ? [] : [each.value]

    content {
      external_enabled = true
      target_port      = ingress.value.port
      transport        = "auto"

      traffic_weight {
        latest_revision = true
        percentage      = 100
      }

      # Only Front Door may reach the ingress; the subnet NSG enforces the
      # same service tag. The tag admits any Front Door profile, so the API
      # also verifies X-Azure-FDID against this environment's profile GUID.
      ip_security_restriction {
        name             = "front-door"
        action           = "Allow"
        ip_address_range = "AzureFrontDoor.Backend"
        description      = "Front Door origin traffic only"
      }
    }
  }

  template {
    min_replicas = each.key == "worker" ? 1 : var.desired_count
    max_replicas = max(4, var.desired_count * 4)

    container {
      name   = "application"
      image  = var.image_uri
      cpu    = 0.5
      memory = "1Gi"

      # The shared entrypoint selects the role from the first argument.
      args = [each.key]

      dynamic "env" {
        for_each = local.runtime_environment[each.key]

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = toset(lookup(local.secret_keys, each.key, []))

        content {
          name        = env.value
          secret_name = local.secret_names[env.value]
        }
      }

      dynamic "readiness_probe" {
        for_each = each.value.health_path == null ? [] : [each.value]

        content {
          transport = "HTTP"
          port      = readiness_probe.value.port
          path      = readiness_probe.value.health_path
        }
      }
    }

    dynamic "http_scale_rule" {
      for_each = each.value.port == null ? [] : [each.value]

      content {
        name                = "http-concurrency"
        concurrent_requests = "50"
      }
    }

    # KEDA postgresql scaler keeps at least one always-on outbox poller and
    # adds replicas while claimable outbox events back up.
    dynamic "custom_scale_rule" {
      for_each = each.key == "worker" ? [each.key] : []

      content {
        name             = "outbox-backlog"
        custom_rule_type = "postgresql"

        metadata = {
          query            = "SELECT COUNT(*) FROM outbox_events WHERE status IN ('pending', 'processing') AND available_at <= now()"
          targetQueryValue = "50"
        }

        authentication {
          secret_name       = local.secret_names["DATABASE_URL"]
          trigger_parameter = "connection"
        }
      }
    }
  }

  tags = local.common_tags

  depends_on = [
    azurerm_role_assignment.acr_pull,
    azurerm_role_assignment.key_vault_secrets,
  ]
}

resource "azurerm_container_app_job" "migrate" {
  name                         = "migrate"
  resource_group_name          = var.resource_group_name
  location                     = var.location
  container_app_environment_id = azurerm_container_app_environment.this.id
  workload_profile_name        = "Consumption"

  replica_timeout_in_seconds = 1800
  replica_retry_limit        = 1

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.application.id]
  }

  registry {
    server   = local.registry_server
    identity = azurerm_user_assigned_identity.application.id
  }

  secret {
    name                = local.secret_names["DATABASE_URL"]
    identity            = azurerm_user_assigned_identity.application.id
    key_vault_secret_id = "${var.key_vault_uri}secrets/${local.secret_names["DATABASE_URL"]}"
  }

  template {
    container {
      name   = "application"
      image  = var.image_uri
      cpu    = 0.5
      memory = "1Gi"
      args   = ["migrate"]

      env {
        name        = "DATABASE_URL"
        secret_name = local.secret_names["DATABASE_URL"]
      }
    }
  }

  tags = local.common_tags

  depends_on = [
    azurerm_role_assignment.acr_pull,
    azurerm_role_assignment.key_vault_secrets,
  ]
}

resource "azurerm_cdn_frontdoor_profile" "this" {
  name                     = var.name
  resource_group_name      = var.resource_group_name
  sku_name                 = "Premium_AzureFrontDoor"
  response_timeout_seconds = 60
  tags                     = local.common_tags
}

resource "azurerm_cdn_frontdoor_firewall_policy" "this" {
  name                = replace(var.name, "-", "")
  resource_group_name = var.resource_group_name
  sku_name            = azurerm_cdn_frontdoor_profile.this.sku_name
  enabled             = true
  mode                = "Prevention"

  custom_rule {
    name                           = "RateLimit"
    enabled                        = true
    priority                       = 100
    type                           = "RateLimitRule"
    action                         = "Block"
    rate_limit_duration_in_minutes = 5
    rate_limit_threshold           = 2000

    match_condition {
      match_variable     = "RemoteAddr"
      operator           = "IPMatch"
      negation_condition = false
      match_values       = ["0.0.0.0/0"]
    }
  }

  managed_rule {
    type    = "Microsoft_DefaultRuleSet"
    version = "2.1"
    action  = "Block"
  }

  managed_rule {
    type    = "Microsoft_BotManagerRuleSet"
    version = "1.0"
    action  = "Block"
  }

  tags = local.common_tags
}

resource "azurerm_cdn_frontdoor_endpoint" "web" {
  name                     = "${var.name}-web"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  tags                     = local.common_tags
}

resource "azurerm_cdn_frontdoor_endpoint" "api" {
  name                     = "${var.name}-api"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  tags                     = local.common_tags
}

resource "azurerm_cdn_frontdoor_origin_group" "web" {
  name                     = "web"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }

  health_probe {
    interval_in_seconds = 30
    path                = "/"
    protocol            = "Https"
    request_type        = "GET"
  }
}

resource "azurerm_cdn_frontdoor_origin_group" "api" {
  name                     = "api"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }

  health_probe {
    interval_in_seconds = 30
    path                = "/health/ready"
    protocol            = "Https"
    request_type        = "GET"
  }
}

resource "azurerm_cdn_frontdoor_origin" "web" {
  name                          = "web"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.web.id

  certificate_name_check_enabled = true
  enabled                        = true
  host_name                      = azurerm_container_app.this["web"].ingress[0].fqdn
  origin_host_header             = azurerm_container_app.this["web"].ingress[0].fqdn
  http_port                      = 80
  https_port                     = 443
  priority                       = 1
  weight                         = 1000
}

resource "azurerm_cdn_frontdoor_origin" "api" {
  name                          = "api"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.api.id

  certificate_name_check_enabled = true
  enabled                        = true
  host_name                      = azurerm_container_app.this["api"].ingress[0].fqdn
  origin_host_header             = azurerm_container_app.this["api"].ingress[0].fqdn
  http_port                      = 80
  https_port                     = 443
  priority                       = 1
  weight                         = 1000
}

resource "azurerm_cdn_frontdoor_rule_set" "api" {
  name                     = "api"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
}

# Preserves the routing header contract the API expects from its edge.
resource "azurerm_cdn_frontdoor_rule" "api_origin_header" {
  name                      = "apioriginheader"
  cdn_frontdoor_rule_set_id = azurerm_cdn_frontdoor_rule_set.api.id
  order                     = 1
  behavior_on_match         = "Continue"

  actions {
    request_header_action {
      header_action = "Overwrite"
      header_name   = "X-Event-Ticketing-Origin"
      value         = "api"
    }
  }

  depends_on = [
    azurerm_cdn_frontdoor_origin_group.api,
    azurerm_cdn_frontdoor_origin.api,
  ]
}

resource "azurerm_cdn_frontdoor_route" "web" {
  name                          = "web"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.web.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.web.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.web.id]

  enabled                = true
  forwarding_protocol    = "HttpsOnly"
  https_redirect_enabled = true
  link_to_default_domain = true
  patterns_to_match      = ["/*"]
  supported_protocols    = ["Http", "Https"]
}

resource "azurerm_cdn_frontdoor_route" "api" {
  name                          = "api"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.api.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.api.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.api.id]
  cdn_frontdoor_rule_set_ids    = [azurerm_cdn_frontdoor_rule_set.api.id]

  enabled                = true
  forwarding_protocol    = "HttpsOnly"
  https_redirect_enabled = true
  link_to_default_domain = true
  patterns_to_match      = ["/*"]
  supported_protocols    = ["Http", "Https"]
}

resource "azurerm_cdn_frontdoor_security_policy" "this" {
  name                     = var.name
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id

  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.this.id

      association {
        patterns_to_match = ["/*"]

        domain {
          cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.web.id
        }

        domain {
          cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.api.id
        }
      }
    }
  }
}

# SMTP credentials for the Azure-managed sender domain are provisioned outside
# Terraform and land in the existing SMTP_URL key vault secret.
resource "azurerm_email_communication_service" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  data_location       = "United States"
  tags                = local.common_tags
}

resource "azurerm_email_communication_service_domain" "this" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.this.id
  domain_management = "AzureManaged"
}

resource "azurerm_communication_service" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  data_location       = "United States"
  tags                = local.common_tags
}

resource "azurerm_communication_service_email_domain_association" "this" {
  communication_service_id = azurerm_communication_service.this.id
  email_service_domain_id  = azurerm_email_communication_service_domain.this.id
}

resource "azurerm_monitor_metric_alert" "front_door_5xx" {
  name                = "${var.name}-front-door-5xx"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_cdn_frontdoor_profile.this.id]
  description         = "Edge is returning server errors."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Cdn/profiles"
    metric_name      = "Percentage5XX"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 5
  }

  tags = local.common_tags
}

resource "azurerm_monitor_diagnostic_setting" "front_door" {
  name                       = "${var.name}-front-door"
  target_resource_id         = azurerm_cdn_frontdoor_profile.this.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category_group = "allLogs"
  }
}

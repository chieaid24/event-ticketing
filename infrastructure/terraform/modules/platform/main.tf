data "aws_region" "current" {}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  common_tags = merge(var.tags, { Component = "platform" })
  secret_keys = {
    api = [
      "DATABASE_URL",
      "PAYMENT_WEBHOOK_SECRET",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_SECRET_KEY",
      "WAITING_ROOM_TOKEN_SECRET",
    ]
    worker = [
      "DATABASE_URL",
      "SMTP_URL",
      "STRIPE_SECRET_KEY",
    ]
  }
  runtime_environment = {
    api = {
      API_COOKIE_SECURE                  = "true"
      API_HOST                           = "0.0.0.0"
      API_PORT                           = "4000"
      API_TRUSTED_ORIGINS                = var.public_origin
      LOG_LEVEL                          = "info"
      PAYMENT_PROVIDER                   = "stripe"
      REDIS_URL                          = "rediss://${var.redis_endpoint}:6379"
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
      REDIS_URL                      = "rediss://${var.redis_endpoint}:6379"
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
      cpu           = 512
      memory        = 1024
      port          = 4000
      health_path   = "/health/ready"
      desired_count = var.desired_count
    }
    web = {
      cpu           = 512
      memory        = 1024
      port          = 3000
      health_path   = "/"
      desired_count = var.desired_count
    }
    worker = {
      cpu           = 512
      memory        = 1024
      port          = null
      health_path   = null
      desired_count = var.desired_count
    }
  }
}

resource "aws_security_group" "load_balancer" {
  name_prefix = "${var.name}-alb-"
  description = "Allow CloudFront origin traffic"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTP from CloudFront origins"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    from_port       = 3000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [var.application_security_group_id]
  }

  tags = local.common_tags
}

resource "aws_security_group_rule" "application_from_alb" {
  type                     = "ingress"
  description              = "Application ports from the load balancer"
  from_port                = 3000
  to_port                  = 4000
  protocol                 = "tcp"
  security_group_id        = var.application_security_group_id
  source_security_group_id = aws_security_group.load_balancer.id
}

resource "aws_lb" "this" {
  name_prefix        = substr(replace(var.name, "-", ""), 0, 6)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.load_balancer.id]
  subnets            = var.public_subnet_ids

  drop_invalid_header_fields = true
  enable_deletion_protection = true

  tags = local.common_tags
}

resource "aws_lb_target_group" "this" {
  for_each = {
    for name, service in local.services : name => service
    if service.port != null
  }

  name_prefix = substr(each.key, 0, 5)
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200-399"
    path                = each.value.health_path
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = local.common_tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this["web"].arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 5

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this["api"].arn
  }

  condition {
    http_header {
      http_header_name = "X-Event-Ticketing-Origin"
      values           = ["api"]
    }
  }
}

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.common_tags
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${var.name}-execution-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution" {
  statement {
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [var.application_secret_arn]
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "read-runtime-secrets"
  policy = data.aws_iam_policy_document.execution.json
  role   = aws_iam_role.execution.id
}

resource "aws_iam_role" "task" {
  for_each = local.services

  name_prefix        = "${var.name}-${each.key}-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "application" {
  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]
    resources = [
      var.artifact_bucket_arn,
      "${var.artifact_bucket_arn}/*",
    ]
  }

  statement {
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
    ]
    resources = [var.kms_key_arn]
  }

  statement {
    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "application" {
  for_each = toset(["api", "worker"])

  name   = "application-integrations"
  policy = data.aws_iam_policy_document.application.json
  role   = aws_iam_role.task[each.key].id
}

resource "aws_cloudwatch_log_group" "service" {
  for_each = local.services

  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn
  tags              = local.common_tags
}

resource "aws_ecs_task_definition" "this" {
  for_each = local.services

  family                   = "${var.name}-${each.key}"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.key].arn

  container_definitions = jsonencode([
    {
      name      = "application"
      image     = var.image_uri
      essential = true
      command   = [each.key]
      environment = [
        for key, value in local.runtime_environment[each.key] : {
          name  = key
          value = value
        }
      ]
      secrets = [
        for key in lookup(local.secret_keys, each.key, []) : {
          name      = key
          valueFrom = "${var.application_secret_arn}:${key}::"
        }
      ]
      portMappings = each.value.port == null ? [] : [{
        name          = each.key
        containerPort = each.value.port
        hostPort      = each.value.port
        protocol      = "tcp"
      }]
      readonlyRootFilesystem = true
      user                   = "node"
      linuxParameters = {
        initProcessEnabled = true
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
          awslogs-region        = data.aws_region.current.region
          awslogs-stream-prefix = "application"
        }
      }
    }
  ])

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  tags = local.common_tags
}

resource "aws_ecs_service" "this" {
  for_each = local.services

  name            = each.key
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  enable_execute_command             = false
  health_check_grace_period_seconds  = each.value.port == null ? null : 60
  propagate_tags                     = "SERVICE"

  network_configuration {
    assign_public_ip = false
    security_groups  = [var.application_security_group_id]
    subnets          = var.application_subnet_ids
  }

  dynamic "load_balancer" {
    for_each = each.value.port == null ? [] : [each.value]

    content {
      container_name   = "application"
      container_port   = load_balancer.value.port
      target_group_arn = aws_lb_target_group.this[each.key].arn
    }
  }

  depends_on = [aws_lb_listener.http]
  tags       = local.common_tags

  lifecycle {
    ignore_changes = [task_definition]
  }
}

resource "aws_appautoscaling_target" "service" {
  for_each = local.services

  max_capacity       = max(4, each.value.desired_count * 4)
  min_capacity       = each.value.desired_count
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.this[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each = local.services

  name               = "${var.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    target_value       = 60
  }
}

resource "aws_ses_configuration_set" "this" {
  name                       = var.name
  reputation_metrics_enabled = true
}

resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common-rule-set"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = false
    }
  }

  rule {
    name     = "rate-limit"
    priority = 20

    action {
      block {}
    }

    statement {
      rate_based_statement {
        aggregate_key_type = "IP"
        limit              = 2000
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate"
      sampled_requests_enabled   = false
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = false
  }

  tags = local.common_tags
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  http_version    = "http2and3"
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"
  web_acl_id      = aws_wafv2_web_acl.this.arn

  origin {
    domain_name = aws_lb.this.dns_name
    origin_id   = "application-load-balancer"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    compress                 = true
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_except_host.id
    target_origin_id         = "application-load-balancer"
    viewer_protocol_policy   = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = local.common_tags
}

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  http_version    = "http2and3"
  is_ipv6_enabled = true
  price_class     = "PriceClass_100"
  web_acl_id      = aws_wafv2_web_acl.this.arn

  origin {
    domain_name = aws_lb.this.dns_name
    origin_id   = "application-load-balancer"

    custom_header {
      name  = "X-Event-Ticketing-Origin"
      value = "api"
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    compress                 = true
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_except_host.id
    target_origin_id         = "application-load-balancer"
    viewer_protocol_policy   = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.name}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.this.arn_suffix
  }

  tags = local.common_tags
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name_prefix        = "${var.name}-deploy-"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "deploy" {
  statement {
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeTasks",
      "ecs:RegisterTaskDefinition",
      "ecs:RunTask",
      "ecs:UpdateService",
    ]
    resources = ["*"]
  }

  statement {
    actions = ["iam:PassRole"]
    resources = concat(
      [aws_iam_role.execution.arn],
      [for role in aws_iam_role.task : role.arn]
    )
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-ecs-services"
  policy = data.aws_iam_policy_document.deploy.json
  role   = aws_iam_role.deploy.id
}

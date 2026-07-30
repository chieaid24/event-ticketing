data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  availability_zones = slice(
    data.aws_availability_zones.available.names,
    0,
    var.availability_zone_count
  )
  common_tags = merge(var.tags, { Component = "network" })
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, { Name = var.name })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${var.name}-igw" })
}

resource "aws_subnet" "public" {
  count = var.availability_zone_count

  availability_zone       = local.availability_zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.this.id

  tags = merge(local.common_tags, {
    Name = "${var.name}-public-${count.index + 1}"
    Tier = "public"
  })
}

resource "aws_subnet" "application" {
  count = var.availability_zone_count

  availability_zone       = local.availability_zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index + 4)
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.this.id

  tags = merge(local.common_tags, {
    Name = "${var.name}-application-${count.index + 1}"
    Tier = "application"
  })
}

resource "aws_subnet" "data" {
  count = var.availability_zone_count

  availability_zone       = local.availability_zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  map_public_ip_on_launch = false
  vpc_id                  = aws_vpc.this.id

  tags = merge(local.common_tags, {
    Name = "${var.name}-data-${count.index + 1}"
    Tier = "data"
  })
}

resource "aws_eip" "nat" {
  count  = var.availability_zone_count
  domain = "vpc"

  depends_on = [aws_internet_gateway.this]
  tags       = merge(local.common_tags, { Name = "${var.name}-nat-${count.index + 1}" })
}

resource "aws_nat_gateway" "this" {
  count = var.availability_zone_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  depends_on = [aws_internet_gateway.this]
  tags       = merge(local.common_tags, { Name = "${var.name}-nat-${count.index + 1}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${var.name}-public" })
}

resource "aws_route" "public_internet" {
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
  route_table_id         = aws_route_table.public.id
}

resource "aws_route_table_association" "public" {
  count = var.availability_zone_count

  route_table_id = aws_route_table.public.id
  subnet_id      = aws_subnet.public[count.index].id
}

resource "aws_route_table" "application" {
  count = var.availability_zone_count

  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${var.name}-application-${count.index + 1}" })
}

resource "aws_route" "application_internet" {
  count = var.availability_zone_count

  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[count.index].id
  route_table_id         = aws_route_table.application[count.index].id
}

resource "aws_route_table_association" "application" {
  count = var.availability_zone_count

  route_table_id = aws_route_table.application[count.index].id
  subnet_id      = aws_subnet.application[count.index].id
}

resource "aws_route_table" "data" {
  count = var.availability_zone_count

  vpc_id = aws_vpc.this.id
  tags   = merge(local.common_tags, { Name = "${var.name}-data-${count.index + 1}" })
}

resource "aws_route_table_association" "data" {
  count = var.availability_zone_count

  route_table_id = aws_route_table.data[count.index].id
  subnet_id      = aws_subnet.data[count.index].id
}

resource "aws_security_group" "endpoints" {
  name_prefix = "${var.name}-endpoints-"
  description = "Allow private application traffic to AWS service endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTPS from the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_security_group" "application" {
  name_prefix = "${var.name}-application-"
  description = "Application tasks"
  vpc_id      = aws_vpc.this.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset([
    "ecr.api",
    "ecr.dkr",
    "logs",
    "secretsmanager",
  ])

  private_dns_enabled = true
  security_group_ids  = [aws_security_group.endpoints.id]
  service_name        = "com.amazonaws.${data.aws_region.current.region}.${each.value}"
  subnet_ids          = aws_subnet.application[*].id
  vpc_endpoint_type   = "Interface"
  vpc_id              = aws_vpc.this.id

  tags = merge(local.common_tags, { Name = "${var.name}-${replace(each.value, ".", "-")}" })
}

data "aws_region" "current" {}

resource "aws_vpc_endpoint" "s3" {
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  route_table_ids   = concat(aws_route_table.application[*].id, aws_route_table.data[*].id)
  vpc_endpoint_type = "Gateway"
  vpc_id            = aws_vpc.this.id

  tags = merge(local.common_tags, { Name = "${var.name}-s3" })
}

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/aws/vpc/${var.name}/flow"
  retention_in_days = 30
  tags              = local.common_tags
}

data "aws_iam_policy_document" "flow_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow" {
  name_prefix        = "${var.name}-flow-"
  assume_role_policy = data.aws_iam_policy_document.flow_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "flow" {
  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.flow.arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow" {
  name   = "write-vpc-flow-logs"
  policy = data.aws_iam_policy_document.flow.json
  role   = aws_iam_role.flow.id
}

resource "aws_flow_log" "this" {
  iam_role_arn    = aws_iam_role.flow.arn
  log_destination = aws_cloudwatch_log_group.flow.arn
  traffic_type    = "REJECT"
  vpc_id          = aws_vpc.this.id
}

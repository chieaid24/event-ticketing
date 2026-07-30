output "application_subnet_ids" {
  value = aws_subnet.application[*].id
}

output "application_security_group_id" {
  value = aws_security_group.application.id
}

output "data_subnet_ids" {
  value = aws_subnet.data[*].id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "vpc_id" {
  value = aws_vpc.this.id
}

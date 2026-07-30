import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "README.md",
  "SECURITY.md",
  "VISION.md",
  "CONTEXT.md",
  "DESIGN.md",
  "compose.yaml",
  "docs/README.md",
  "docs/maintenance.md",
  "docs/product/requirements.md",
  "docs/product/roadmap.md",
  "docs/architecture/system.md",
  "docs/architecture/domain-model.md",
  "docs/architecture/inventory-and-checkout.md",
  "docs/engineering/standards.md",
  "docs/security/security-model.md",
  "docs/testing/strategy.md",
  "docs/operations/runbook-index.md",
  "docs/operations/aws-deployment.md",
  "docs/adr/README.md",
  "docs/adr/0001-monorepo-and-service-boundaries.md",
  "docs/adr/0010-aws-ecs-single-image-deployment.md",
  "docs/runbooks/aws-backup-restoration.md",
  "docs/runbooks/aws-rollback.md",
  "docs/runbooks/aws-secret-rotation.md",
  "apps/web/README.md",
  "apps/api/README.md",
  "apps/worker/README.md",
  "packages/contracts/README.md",
  "packages/database/README.md",
  "packages/config/README.md",
  "packages/ui/README.md",
  "packages/test-utils/README.md",
  "infrastructure/README.md",
  "infrastructure/container/Dockerfile",
  "infrastructure/terraform/README.md",
  "infrastructure/terraform/foundation/main.tf",
  "infrastructure/terraform/environments/staging/main.tf",
  "infrastructure/terraform/environments/production/main.tf",
  "infrastructure/terraform/modules/network/main.tf",
  "infrastructure/terraform/modules/data/main.tf",
  "infrastructure/terraform/modules/platform/main.tf",
  ".github/workflows/deploy.yml",
  "scripts/container-entrypoint.sh",
  "scripts/deploy-ecs.sh",
];

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(path)));
    } else if (extname(entry.name) === ".md") {
      files.push(path);
    }
  }

  return files;
}

test("required project documents exist", async () => {
  for (const file of requiredFiles) {
    assert.equal((await stat(join(root, file))).isFile(), true, file);
  }
});

test("workspace entry points exist", async () => {
  const requiredEntryPoints = [
    "apps/web/package.json",
    "apps/web/src/app/page.tsx",
    "apps/api/package.json",
    "apps/api/src/main.ts",
    "apps/worker/package.json",
    "apps/worker/src/main.ts",
    "packages/contracts/package.json",
    "packages/database/package.json",
    "packages/config/package.json",
    "packages/ui/package.json",
    "packages/test-utils/package.json",
    "packages/database/prisma/schema.prisma",
    "packages/database/prisma/migrations/20260724190000_identity_baseline/migration.sql",
    "turbo.json",
    "tsconfig.base.json",
  ];

  for (const file of requiredEntryPoints) {
    assert.equal((await stat(join(root, file))).isFile(), true, file);
  }
});

test("local service images and health checks are pinned", async () => {
  const compose = await readFile(join(root, "compose.yaml"), "utf8");
  const services = ["postgres", "redis", "mailpit", "minio"];
  const pinnedImage = /^\s+image: \S+:[^@\s]+@sha256:[0-9a-f]{64}\s*$/gm;

  assert.equal([...compose.matchAll(pinnedImage)].length, services.length);

  for (const service of services) {
    assert.match(compose, new RegExp(`^  ${service}:$`, "m"));
  }

  assert.equal(
    compose.match(/^\s+healthcheck:\s*$/gm)?.length,
    services.length
  );
});

test("AWS infrastructure preserves isolation and immutable promotion", async () => {
  const network = await readFile(
    join(root, "infrastructure/terraform/modules/network/main.tf"),
    "utf8"
  );
  const data = await readFile(
    join(root, "infrastructure/terraform/modules/data/main.tf"),
    "utf8"
  );
  const platform = await readFile(
    join(root, "infrastructure/terraform/modules/platform/main.tf"),
    "utf8"
  );
  const foundation = await readFile(
    join(root, "infrastructure/terraform/foundation/main.tf"),
    "utf8"
  );
  const deployment = await readFile(
    join(root, ".github/workflows/deploy.yml"),
    "utf8"
  );
  const dockerfile = await readFile(
    join(root, "infrastructure/container/Dockerfile"),
    "utf8"
  );

  for (const tier of ["public", "application", "data"]) {
    assert.match(network, new RegExp(`resource "aws_subnet" "${tier}"`));
  }
  assert.match(network, /map_public_ip_on_launch = false/g);
  assert.match(data, /publicly_accessible\s+= false/);
  assert.match(data, /multi_az\s+= true/g);
  assert.match(data, /resource "aws_backup_plan"/);
  assert.match(platform, /assign_public_ip = false/);
  assert.match(platform, /resource "aws_wafv2_web_acl"/);
  assert.match(platform, /resource "aws_cloudfront_distribution" "api"/);
  assert.match(platform, /http_header_name = "X-Event-Ticketing-Origin"/);
  assert.match(platform, /API_BASE_URL = var\.api_origin/);
  assert.match(platform, /resource "aws_appautoscaling_policy"/);
  assert.match(platform, /AssumeRoleWithWebIdentity/);
  assert.match(foundation, /image_tag_mutability = "IMMUTABLE"/);
  assert.match(deployment, /id-token: write/);
  assert.match(deployment, /needs: \[build, staging\]/);
  assert.match(deployment, /needs\.build\.outputs\.image-uri/g);
  assert.doesNotMatch(deployment, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
  assert.match(dockerfile, /^FROM .+@sha256:[0-9a-f]{64}/m);
});

test("project documents do not use discarded names", async () => {
  const files = await markdownFiles(root);
  const discardedName = /\b(?:agent[ -]trail|seat ?flow)\b/i;

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, discardedName, relative(root, file));
  }
});

test("project documents use printable ASCII", async () => {
  const files = await markdownFiles(root);
  const nonAscii = /[^\x09\x0a\x0d\x20-\x7e]/;

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, nonAscii, relative(root, file));
  }
});

test("relative Markdown links resolve", async () => {
  const files = await markdownFiles(root);
  const failures = [];
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(linkPattern)) {
      const target = match[1].split("#", 1)[0];
      if (
        !target ||
        target.startsWith("http") ||
        target.startsWith("mailto:")
      ) {
        continue;
      }

      const path = resolve(dirname(file), decodeURIComponent(target));
      try {
        await stat(path);
      } catch {
        failures.push(`${relative(root, file)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

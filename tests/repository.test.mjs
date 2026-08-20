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
  "docs/testing/2026-07-31-release-verification.md",
  "docs/operations/runbook-index.md",
  "docs/operations/azure-deployment.md",
  "docs/adr/README.md",
  "docs/adr/0001-monorepo-and-service-boundaries.md",
  "docs/adr/0010-azure-container-apps-single-image-deployment.md",
  "docs/runbooks/azure-backup-restoration.md",
  "docs/runbooks/azure-rollback.md",
  "docs/runbooks/azure-secret-rotation.md",
  "docs/load-tests/2026-07-31-release-verification.md",
  "apps/web/README.md",
  "apps/api/README.md",
  "apps/worker/README.md",
  "packages/contracts/README.md",
  "packages/database/README.md",
  "packages/payments/README.md",
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
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
  "scripts/container-entrypoint.sh",
  "scripts/deploy-container-apps.sh",
  "scripts/repeat-integration.mjs",
  "scripts/smoke-api.mjs",
  "scripts/verify-local-recovery.mjs",
  "playwright.config.ts",
  "tests/e2e/release-journey.spec.ts",
  "tests/e2e/security-boundaries.spec.ts",
  "tests/load/release-verification.js",
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
    "packages/payments/package.json",
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
  const services = [
    "postgres",
    "redis",
    "mailpit",
    "minio",
    "minio-init",
    "turbo-remote-cache",
    "prometheus",
    "grafana",
  ];
  // One-shot bootstrap containers exit instead of reporting health.
  const oneShotServices = ["minio-init"];
  const pinnedImage = /^\s+image: \S+:[^@\s]+@sha256:[0-9a-f]{64}\s*$/gm;

  assert.equal([...compose.matchAll(pinnedImage)].length, services.length);

  for (const service of services) {
    assert.match(compose, new RegExp(`^  ${service}:$`, "m"));
  }

  assert.equal(
    compose.match(/^\s+healthcheck:\s*$/gm)?.length,
    services.length - oneShotServices.length
  );
});

test("Azure infrastructure preserves isolation and immutable promotion", async () => {
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

  for (const tier of ["container_apps", "database", "private_endpoints"]) {
    assert.match(network, new RegExp(`resource "azurerm_subnet" "${tier}"`));
  }
  assert.match(network, /service_delegation/g);
  assert.match(data, /public_network_access_enabled\s+= false/g);
  assert.match(data, /public_network_access\s+= "Disabled"/);
  assert.match(data, /high_availability/);
  assert.match(data, /mode\s+= "ZoneRedundant"/);
  assert.match(platform, /zone_redundancy_enabled\s+= true/);
  assert.match(platform, /resource "azurerm_cdn_frontdoor_firewall_policy"/);
  assert.match(platform, /header_name\s+= "X-Event-Ticketing-Origin"/);
  assert.match(platform, /API_BASE_URL = var\.api_origin/);
  assert.match(platform, /http_scale_rule/);
  assert.match(platform, /custom_scale_rule/);
  assert.match(foundation, /resource "azurerm_federated_identity_credential"/);
  assert.match(deployment, /id-token: write/);
  assert.match(deployment, /needs: \[build, staging\]/);
  assert.match(deployment, /needs\.build\.outputs\.image-uri/g);
  assert.doesNotMatch(
    deployment,
    /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AZURE_CLIENT_SECRET|AZURE_CREDENTIALS/
  );
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

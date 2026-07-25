import { describe, expect, it } from "vitest";

import {
  changeMemberRoleRequestSchema,
  createOrganizationRequestSchema,
  inviteMemberRequestSchema,
  membershipRoleSchema,
  organizationDetailResponseSchema,
  organizationSlugSchema,
  updateOrganizationSettingsRequestSchema,
} from "./organizations.js";

describe("organizationSlugSchema", () => {
  it("accepts canonical kebab-case slugs", () => {
    expect(organizationSlugSchema.parse("riverside-concert-hall")).toBe(
      "riverside-concert-hall"
    );
  });

  it.each(["Not A Slug", "UPPER", "double--dash", "-lead", "trail-", "ab"])(
    "rejects %j",
    (slug) => {
      expect(organizationSlugSchema.safeParse(slug).success).toBe(false);
    }
  );
});

describe("createOrganizationRequestSchema", () => {
  it("trims the name and keeps the slug", () => {
    const parsed = createOrganizationRequestSchema.parse({
      name: "  Riverside Concert Hall  ",
      slug: "riverside-concert-hall",
    });
    expect(parsed.name).toBe("Riverside Concert Hall");
  });

  it("rejects unknown fields", () => {
    const result = createOrganizationRequestSchema.safeParse({
      name: "Riverside Concert Hall",
      role: "owner",
      slug: "riverside-concert-hall",
    });
    expect(result.success).toBe(false);
  });
});

describe("member mutation requests", () => {
  it("normalizes the invited email", () => {
    const parsed = inviteMemberRequestSchema.parse({
      email: "  Guest@Example.Test ",
      role: "viewer",
    });
    expect(parsed.email).toBe("guest@example.test");
  });

  it("rejects a role outside the documented set", () => {
    expect(
      inviteMemberRequestSchema.safeParse({
        email: "guest@example.test",
        role: "superuser",
      }).success
    ).toBe(false);
  });

  it("requires the previously seen role on role changes", () => {
    expect(
      changeMemberRoleRequestSchema.safeParse({ role: "viewer" }).success
    ).toBe(false);
  });

  it("requires a positive integer settings version", () => {
    expect(
      updateOrganizationSettingsRequestSchema.safeParse({
        name: "Riverside Concert Hall",
        version: 0,
      }).success
    ).toBe(false);
  });
});

describe("organizationDetailResponseSchema", () => {
  it("validates a full detail payload", () => {
    const parsed = organizationDetailResponseSchema.parse({
      membership: {
        assignableRoles: membershipRoleSchema.options,
        permissions: ["organization.read", "organization.delete"],
        role: "owner",
      },
      organization: {
        createdAt: new Date().toISOString(),
        id: "11111111-1111-4111-8111-111111111111",
        name: "Example Test Box Office",
        slug: "example-test-box-office",
        version: 3,
      },
    });
    expect(parsed.membership.role).toBe("owner");
  });
});

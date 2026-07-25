import { describe, expect, it } from "vitest";

import {
  membershipRoleSchema,
  organizationPermissionSchema,
} from "@event-ticketing/contracts";

import {
  assignableRoles,
  canManageRole,
  hasPermission,
  rolePermissions,
} from "./policy.js";

const roles = membershipRoleSchema.options;
const permissions = organizationPermissionSchema.options;

describe("rolePermissions", () => {
  it("covers every role with only known permissions", () => {
    for (const role of roles) {
      expect(rolePermissions[role].length).toBeGreaterThan(0);
      for (const permission of rolePermissions[role]) {
        expect(permissions).toContain(permission);
      }
    }
  });

  it("matches the documented policy matrix exactly", () => {
    const matrix = Object.fromEntries(
      roles.map((role) => [
        role,
        permissions.filter((permission) => hasPermission(role, permission)),
      ])
    );
    expect(matrix).toEqual({
      admin: [
        "organization.read",
        "organization.settings.update",
        "members.read",
        "members.invite",
        "members.role.update",
        "members.remove",
        "audit.read",
        "venues.manage",
        "events.manage",
        "finance.manage",
        "scanner.checkin",
      ],
      event_manager: [
        "organization.read",
        "members.read",
        "venues.manage",
        "events.manage",
      ],
      finance: ["organization.read", "members.read", "finance.manage"],
      owner: [...permissions],
      scanner: ["organization.read", "scanner.checkin"],
      viewer: ["organization.read", "members.read"],
    });
  });

  it("reserves deletion for owners", () => {
    for (const role of roles) {
      expect(hasPermission(role, "organization.delete")).toBe(role === "owner");
    }
  });
});

describe("assignableRoles", () => {
  it("lets owners grant every role including owner", () => {
    expect(assignableRoles("owner")).toEqual(roles);
  });

  it("limits admins to non-privileged roles", () => {
    expect(assignableRoles("admin")).toEqual([
      "event_manager",
      "finance",
      "scanner",
      "viewer",
    ]);
  });

  it("gives every other role no grants", () => {
    for (const role of [
      "event_manager",
      "finance",
      "scanner",
      "viewer",
    ] as const) {
      expect(assignableRoles(role)).toEqual([]);
    }
  });
});

describe("canManageRole", () => {
  it("lets owners manage every role", () => {
    for (const target of roles) {
      expect(canManageRole("owner", target)).toBe(true);
    }
  });

  it("blocks admins from managing owners and other admins", () => {
    expect(canManageRole("admin", "owner")).toBe(false);
    expect(canManageRole("admin", "admin")).toBe(false);
    expect(canManageRole("admin", "viewer")).toBe(true);
    expect(canManageRole("admin", "scanner")).toBe(true);
  });

  it("blocks every non-managing role", () => {
    for (const actor of [
      "event_manager",
      "finance",
      "scanner",
      "viewer",
    ] as const) {
      for (const target of roles) {
        expect(canManageRole(actor, target)).toBe(false);
      }
    }
  });
});

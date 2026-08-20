import type {
  MembershipRole,
  OrganizationPermission,
} from "@event-ticketing/contracts";

export const rolePermissions: Readonly<
  Record<MembershipRole, readonly OrganizationPermission[]>
> = {
  admin: [
    "organization.read",
    "organization.settings.update",
    "members.read",
    "members.invite",
    "members.role.update",
    "members.remove",
    "audit.read",
    "analytics.read",
    "operations.read",
    "operations.manage",
    "venues.manage",
    "events.manage",
    "finance.manage",
    "scanner.checkin",
    "scanner.reverse",
  ],
  event_manager: [
    "organization.read",
    "members.read",
    "analytics.read",
    "venues.manage",
    "events.manage",
  ],
  finance: [
    "organization.read",
    "members.read",
    "analytics.read",
    "finance.manage",
  ],
  owner: [
    "organization.read",
    "organization.settings.update",
    "organization.delete",
    "members.read",
    "members.invite",
    "members.role.update",
    "members.remove",
    "audit.read",
    "analytics.read",
    "operations.read",
    "operations.manage",
    "venues.manage",
    "events.manage",
    "finance.manage",
    "scanner.checkin",
    "scanner.reverse",
  ],
  scanner: ["organization.read", "scanner.checkin"],
  viewer: ["organization.read", "members.read"],
};

export function hasPermission(
  role: MembershipRole,
  permission: OrganizationPermission
): boolean {
  return rolePermissions[role].includes(permission);
}

// roles a member may grant when inviting/changing a member
export function assignableRoles(role: MembershipRole): MembershipRole[] {
  switch (role) {
    case "owner":
      return [
        "owner",
        "admin",
        "event_manager",
        "finance",
        "scanner",
        "viewer",
      ];
    case "admin":
      return ["event_manager", "finance", "scanner", "viewer"];
    default:
      return [];
  }
}

// whether actor role may change/remove a member with target role
export function canManageRole(
  actorRole: MembershipRole,
  targetRole: MembershipRole
): boolean {
  if (actorRole === "owner") {
    return true;
  }
  if (actorRole === "admin") {
    return assignableRoles("admin").includes(targetRole);
  }
  return false;
}

import type {
  MembershipRole,
  OrganizationPermission,
} from "@event-ticketing/contracts";

/**
 * Documented in docs/security/authorization.md. Change both together.
 */
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
    "events.manage",
    "finance.manage",
    "scanner.checkin",
  ],
  event_manager: ["organization.read", "members.read", "events.manage"],
  finance: ["organization.read", "members.read", "finance.manage"],
  owner: [
    "organization.read",
    "organization.settings.update",
    "organization.delete",
    "members.read",
    "members.invite",
    "members.role.update",
    "members.remove",
    "audit.read",
    "events.manage",
    "finance.manage",
    "scanner.checkin",
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

/** Roles a member may grant when inviting or changing another member. */
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

/** Whether an actor role may change or remove a member holding a target role. */
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

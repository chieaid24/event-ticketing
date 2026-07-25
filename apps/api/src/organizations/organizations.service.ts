import {
  changeMemberRoleRequestSchema,
  createOrganizationRequestSchema,
  deleteOrganizationRequestSchema,
  inviteMemberRequestSchema,
  updateOrganizationSettingsRequestSchema,
  type AcceptedResponse,
  type AuditLogListResponse,
  type MembershipContext,
  type MembershipRole,
  type MemberListResponse,
  type Organization,
  type OrganizationDetailResponse,
  type OrganizationListResponse,
  type OrganizationPermission,
} from "@event-ticketing/contracts";
import type { MembershipRow, OrganizationRow } from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import {
  assignableRoles,
  canManageRole,
  hasPermission,
  rolePermissions,
} from "./policy.js";
import type {
  InvitationResponse,
  OrganizationsStore,
} from "./organizations.store.js";

const AUDIT_LOG_LIMIT = 100;

/** The slice of AuthService this service needs; kept narrow for tests. */
export interface SessionAuthenticator {
  requireMutationSession(
    context: RequestAuthContext
  ): Promise<AuthenticatedSession>;
  requireSession(context: RequestAuthContext): Promise<AuthenticatedSession>;
}

interface ActiveMembership {
  membership: MembershipRow;
  organization: OrganizationRow;
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version,
  };
}

function toMembershipContext(role: MembershipRole): MembershipContext {
  return {
    assignableRoles: assignableRoles(role),
    permissions: [...rolePermissions[role]],
    role,
  };
}

/** A path id that cannot be a UUID gets the same answer as a missing row. */
function requireUuid(
  value: string,
  status: number,
  code: string,
  message: string
): void {
  if (!uuidPattern.test(value)) {
    apiError(status, code, message);
  }
}

export class OrganizationsService {
  constructor(
    private readonly auth: SessionAuthenticator,
    private readonly store: OrganizationsStore
  ) {}

  async createOrganization(
    context: RequestAuthContext,
    input: unknown
  ): Promise<OrganizationDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const request = parseRequest(createOrganizationRequestSchema, input);
    const result = await this.store.createOrganization({
      actorUserId: user.id,
      name: request.name,
      slug: request.slug,
    });
    if (result === "slug_taken") {
      apiError(409, "slug_taken", "That URL name is already in use.");
    }
    return {
      membership: toMembershipContext(result.membership.role),
      organization: toOrganization(result.organization),
    };
  }

  async listOrganizations(
    context: RequestAuthContext
  ): Promise<OrganizationListResponse> {
    const { user } = await this.auth.requireSession(context);
    const { invitations, organizations } = await this.store.listForUser(
      user.id
    );
    return {
      invitations: invitations.map((row) => ({
        createdAt: row.createdAt.toISOString(),
        invitedByEmail: row.invitedByEmail,
        membershipId: row.id,
        organization: {
          id: row.organizationId,
          name: row.organizationName,
          slug: row.organizationSlug,
        },
        role: row.role,
      })),
      organizations: organizations.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        slug: row.slug,
      })),
    };
  }

  async getOrganization(
    context: RequestAuthContext,
    organizationId: string
  ): Promise<OrganizationDetailResponse> {
    const { user } = await this.auth.requireSession(context);
    const { membership, organization } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    return {
      membership: toMembershipContext(membership.role),
      organization: toOrganization(organization),
    };
  }

  async updateSettings(
    context: RequestAuthContext,
    organizationId: string,
    input: unknown
  ): Promise<OrganizationDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "organization.settings.update");
    const request = parseRequest(
      updateOrganizationSettingsRequestSchema,
      input
    );

    const result = await this.store.updateSettings({
      actorUserId: user.id,
      expectedVersion: request.version,
      name: request.name,
      organizationId,
    });
    if (result === "version_conflict") {
      apiError(
        409,
        "version_conflict",
        "The organization changed since you loaded it. Reload and retry."
      );
    }
    return {
      membership: toMembershipContext(membership.role),
      organization: toOrganization(result),
    };
  }

  async deleteOrganization(
    context: RequestAuthContext,
    organizationId: string,
    input: unknown
  ): Promise<AcceptedResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership, organization } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "organization.delete");
    const request = parseRequest(deleteOrganizationRequestSchema, input);
    if (request.confirmSlug !== organization.slug) {
      apiError(
        400,
        "confirmation_mismatch",
        "Type the organization URL name exactly to confirm deletion."
      );
    }

    const deleted = await this.store.deleteOrganization({
      actorUserId: user.id,
      organizationId,
    });
    if (!deleted) {
      this.organizationNotFound();
    }
    return { status: "accepted" };
  }

  async listMembers(
    context: RequestAuthContext,
    organizationId: string
  ): Promise<MemberListResponse> {
    const { user } = await this.auth.requireSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "members.read");
    const members = await this.store.listMembers(organizationId);
    return {
      members: members.map((row) => ({
        email: row.email,
        joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
        membershipId: row.id,
        role: row.role,
        status: row.status,
        userId: row.userId,
      })),
    };
  }

  async inviteMember(
    context: RequestAuthContext,
    organizationId: string,
    input: unknown
  ): Promise<AcceptedResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "members.invite");
    const request = parseRequest(inviteMemberRequestSchema, input);
    this.requireAssignableRole(membership.role, request.role);

    // Always generic so invitations cannot confirm whether an email has an
    // account; see docs/security/authorization.md.
    await this.store.inviteMember({
      actorUserId: user.id,
      email: request.email,
      organizationId,
      role: request.role,
    });
    return { status: "accepted" };
  }

  async respondToInvitation(
    context: RequestAuthContext,
    membershipId: string,
    response: InvitationResponse
  ): Promise<AcceptedResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    requireUuid(
      membershipId,
      404,
      "invitation_not_found",
      "The invitation does not exist or was already answered."
    );
    const outcome = await this.store.respondToInvitation({
      membershipId,
      response,
      userId: user.id,
    });
    if (!outcome) {
      apiError(
        404,
        "invitation_not_found",
        "The invitation does not exist or was already answered."
      );
    }
    return { status: "accepted" };
  }

  async changeMemberRole(
    context: RequestAuthContext,
    organizationId: string,
    membershipId: string,
    input: unknown
  ): Promise<AcceptedResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "members.role.update");
    const request = parseRequest(changeMemberRoleRequestSchema, input);
    const target = await this.requireTargetMembership(
      organizationId,
      membershipId
    );
    if (target.userId === user.id) {
      apiError(
        403,
        "cannot_change_own_role",
        "You cannot change your own role. Another owner must change it."
      );
    }
    if (!canManageRole(membership.role, target.role)) {
      apiError(403, "forbidden", "Your role cannot manage this member.");
    }
    this.requireAssignableRole(membership.role, request.role);
    if (request.expectedRole !== target.role) {
      this.roleConflict();
    }

    const result = await this.store.changeMemberRole({
      actorUserId: user.id,
      expectedRole: target.role,
      membershipId,
      newRole: request.role,
      organizationId,
      targetUserId: target.userId,
    });
    if (result === "conflict") {
      this.roleConflict();
    }
    if (result === "last_owner") {
      this.lastOwner();
    }
    return { status: "accepted" };
  }

  async removeMember(
    context: RequestAuthContext,
    organizationId: string,
    membershipId: string
  ): Promise<AcceptedResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    const target = await this.requireTargetMembership(
      organizationId,
      membershipId
    );
    const leaving = target.userId === user.id;
    // Any member may leave; removing someone else needs manage rights.
    if (!leaving) {
      this.requirePermission(membership.role, "members.remove");
      if (!canManageRole(membership.role, target.role)) {
        apiError(403, "forbidden", "Your role cannot manage this member.");
      }
    }

    const result = await this.store.removeMember({
      actorUserId: user.id,
      expectedRole: target.role,
      left: leaving,
      membershipId,
      organizationId,
      targetUserId: target.userId,
    });
    if (result === "conflict") {
      this.roleConflict();
    }
    if (result === "last_owner") {
      this.lastOwner();
    }
    return { status: "accepted" };
  }

  async listAuditLogs(
    context: RequestAuthContext,
    organizationId: string
  ): Promise<AuditLogListResponse> {
    const { user } = await this.auth.requireSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "audit.read");
    const entries = await this.store.listAuditLogs({
      limit: AUDIT_LOG_LIMIT,
      organizationId,
    });
    return {
      entries: entries.map((row) => ({
        action: row.action,
        actorEmail: row.actorEmail,
        createdAt: row.createdAt.toISOString(),
        detail: row.detail,
        id: row.id,
        targetId: row.targetId,
        targetType: row.targetType,
      })),
    };
  }

  /**
   * Non-members get the same 404 as a missing organization so that probing
   * cannot confirm an organization exists.
   */
  private async requireActiveMembership(
    organizationId: string,
    userId: string
  ): Promise<ActiveMembership> {
    requireUuid(
      organizationId,
      404,
      "organization_not_found",
      "The organization does not exist."
    );
    const organization = await this.store.findOrganization(organizationId);
    const membership = organization
      ? await this.store.findMembership({ organizationId, userId })
      : null;
    if (!organization || !membership || membership.status !== "active") {
      this.organizationNotFound();
    }
    return { membership, organization };
  }

  private async requireTargetMembership(
    organizationId: string,
    membershipId: string
  ): Promise<MembershipRow> {
    requireUuid(
      membershipId,
      404,
      "member_not_found",
      "The member was not found."
    );
    const target = await this.store.findMembershipById({
      membershipId,
      organizationId,
    });
    if (!target || target.status === "removed") {
      apiError(404, "member_not_found", "The member was not found.");
    }
    return target;
  }

  private requirePermission(
    role: MembershipRole,
    permission: OrganizationPermission
  ): void {
    if (!hasPermission(role, permission)) {
      apiError(403, "forbidden", "Your role does not allow this action.");
    }
  }

  private requireAssignableRole(
    actorRole: MembershipRole,
    role: MembershipRole
  ): void {
    if (!assignableRoles(actorRole).includes(role)) {
      apiError(403, "role_not_assignable", "Your role cannot grant that role.");
    }
  }

  private organizationNotFound(): never {
    apiError(404, "organization_not_found", "The organization does not exist.");
  }

  private roleConflict(): never {
    apiError(
      409,
      "membership_conflict",
      "The membership changed since you loaded it. Reload and retry."
    );
  }

  private lastOwner(): never {
    apiError(
      409,
      "last_owner",
      "An organization must keep at least one active owner."
    );
  }
}

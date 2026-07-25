import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  acceptInvitation,
  countActiveOwners,
  createDatabasePool,
  declineInvitation,
  deleteOrganizationById,
  enqueueOutboxEvent,
  findMembershipById,
  findMembershipByUser,
  findOrganizationById,
  findUserByEmail,
  insertActiveOwnerMembership,
  insertAuditLog,
  insertOrganization,
  listAuditLogs,
  listInvitationsForUser,
  listMembers,
  listOrganizationsForUser,
  lockOrganization,
  removeMembership,
  updateMembershipRole,
  updateOrganizationName,
  upsertInvitation,
  withDatabaseTransaction,
  type AuditLogRow,
  type DatabaseExecutor,
  type InvitationRow,
  type MembershipRole,
  type MembershipRow,
  type MemberRow,
  type OrganizationRow,
  type OrganizationWithRoleRow,
} from "@event-ticketing/database";

export const ORGANIZATION_CREATED_TOPIC = "organization.created";

export type CreateOrganizationResult =
  { membership: MembershipRow; organization: OrganizationRow } | "slug_taken";

export type InviteMemberResult = "invited" | "already_member" | "skipped";

export type InvitationResponse = "accept" | "decline";

export type RoleChangeResult = "changed" | "conflict" | "last_owner";

export type RemoveMemberResult = "removed" | "conflict" | "last_owner";

export type UpdateSettingsResult = OrganizationRow | "version_conflict";

export interface OrganizationsStore {
  changeMemberRole(input: {
    actorUserId: string;
    expectedRole: MembershipRole;
    membershipId: string;
    newRole: MembershipRole;
    organizationId: string;
    targetUserId: string;
  }): Promise<RoleChangeResult>;
  createOrganization(input: {
    actorUserId: string;
    name: string;
    slug: string;
  }): Promise<CreateOrganizationResult>;
  deleteOrganization(input: {
    actorUserId: string;
    organizationId: string;
  }): Promise<boolean>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null>;
  findMembershipById(input: {
    membershipId: string;
    organizationId: string;
  }): Promise<MembershipRow | null>;
  findOrganization(organizationId: string): Promise<OrganizationRow | null>;
  inviteMember(input: {
    actorUserId: string;
    email: string;
    organizationId: string;
    role: MembershipRole;
  }): Promise<InviteMemberResult>;
  listAuditLogs(input: {
    limit: number;
    organizationId: string;
  }): Promise<AuditLogRow[]>;
  listForUser(userId: string): Promise<{
    invitations: InvitationRow[];
    organizations: OrganizationWithRoleRow[];
  }>;
  listMembers(organizationId: string): Promise<MemberRow[]>;
  removeMember(input: {
    actorUserId: string;
    expectedRole: MembershipRole;
    left: boolean;
    membershipId: string;
    organizationId: string;
    targetUserId: string;
  }): Promise<RemoveMemberResult>;
  respondToInvitation(input: {
    membershipId: string;
    response: InvitationResponse;
    userId: string;
  }): Promise<InvitationResponse | null>;
  updateSettings(input: {
    actorUserId: string;
    expectedVersion: number;
    name: string;
    organizationId: string;
  }): Promise<UpdateSettingsResult>;
}

/** Thrown inside a transaction to roll back a change that strands an org. */
class LastOwnerError extends Error {
  constructor() {
    super("The organization would be left without an active owner.");
    this.name = "LastOwnerError";
  }
}

export class PgOrganizationsStore
  implements OrganizationsStore, OnApplicationShutdown
{
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async createOrganization(input: {
    actorUserId: string;
    name: string;
    slug: string;
  }): Promise<CreateOrganizationResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const organization = await insertOrganization(tx, {
        name: input.name,
        slug: input.slug,
      });
      if (!organization) {
        return "slug_taken";
      }

      const membership = await insertActiveOwnerMembership(tx, {
        organizationId: organization.id,
        userId: input.actorUserId,
      });
      await insertAuditLog(tx, {
        action: "organization.created",
        actorUserId: input.actorUserId,
        detail: { name: organization.name, slug: organization.slug },
        organizationId: organization.id,
        targetId: organization.id,
        targetType: "organization",
      });
      await enqueueOutboxEvent(tx, {
        aggregateId: organization.id,
        aggregateType: "organization",
        deduplicationKey: `${ORGANIZATION_CREATED_TOPIC}:${organization.id}`,
        payload: { organizationId: organization.id },
        topic: ORGANIZATION_CREATED_TOPIC,
      });
      return { membership, organization };
    });
  }

  async listForUser(userId: string): Promise<{
    invitations: InvitationRow[];
    organizations: OrganizationWithRoleRow[];
  }> {
    const [organizations, invitations] = await Promise.all([
      listOrganizationsForUser(this.pool, userId),
      listInvitationsForUser(this.pool, userId),
    ]);
    return { invitations, organizations };
  }

  async findOrganization(
    organizationId: string
  ): Promise<OrganizationRow | null> {
    return findOrganizationById(this.pool, organizationId);
  }

  async findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null> {
    return findMembershipByUser(this.pool, input);
  }

  async findMembershipById(input: {
    membershipId: string;
    organizationId: string;
  }): Promise<MembershipRow | null> {
    return findMembershipById(this.pool, input);
  }

  async listMembers(organizationId: string): Promise<MemberRow[]> {
    return listMembers(this.pool, organizationId);
  }

  async inviteMember(input: {
    actorUserId: string;
    email: string;
    organizationId: string;
    role: MembershipRole;
  }): Promise<InviteMemberResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const user = await findUserByEmail(tx, input.email);
      // Only verified accounts are invitable; the response stays generic
      // either way so invitations cannot probe for accounts cheaply.
      if (!user || user.status !== "active") {
        return "skipped";
      }

      const membership = await upsertInvitation(tx, {
        invitedById: input.actorUserId,
        organizationId: input.organizationId,
        role: input.role,
        userId: user.id,
      });
      if (!membership) {
        return "already_member";
      }

      await insertAuditLog(tx, {
        action: "member.invited",
        actorUserId: input.actorUserId,
        detail: { role: input.role, targetUserId: user.id },
        organizationId: input.organizationId,
        targetId: membership.id,
        targetType: "membership",
      });
      return "invited";
    });
  }

  async respondToInvitation(input: {
    membershipId: string;
    response: InvitationResponse;
    userId: string;
  }): Promise<InvitationResponse | null> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const membership =
        input.response === "accept"
          ? await acceptInvitation(tx, {
              membershipId: input.membershipId,
              userId: input.userId,
            })
          : await declineInvitation(tx, {
              membershipId: input.membershipId,
              userId: input.userId,
            });
      if (!membership) {
        return null;
      }

      await insertAuditLog(tx, {
        action:
          input.response === "accept"
            ? "member.joined"
            : "member.invitation.declined",
        actorUserId: input.userId,
        detail: { role: membership.role, targetUserId: input.userId },
        organizationId: membership.organizationId,
        targetId: membership.id,
        targetType: "membership",
      });
      return input.response;
    });
  }

  async changeMemberRole(input: {
    actorUserId: string;
    expectedRole: MembershipRole;
    membershipId: string;
    newRole: MembershipRole;
    organizationId: string;
    targetUserId: string;
  }): Promise<RoleChangeResult> {
    try {
      return await withDatabaseTransaction(this.pool, async (tx) => {
        if (!(await lockOrganization(tx, input.organizationId))) {
          return "conflict";
        }
        const updated = await updateMembershipRole(tx, {
          expectedRole: input.expectedRole,
          membershipId: input.membershipId,
          organizationId: input.organizationId,
          role: input.newRole,
        });
        if (!updated) {
          return "conflict";
        }
        await this.assertOwnerRemains(tx, input);
        await insertAuditLog(tx, {
          action: "member.role.changed",
          actorUserId: input.actorUserId,
          detail: {
            previousRole: input.expectedRole,
            role: input.newRole,
            targetUserId: input.targetUserId,
          },
          organizationId: input.organizationId,
          targetId: input.membershipId,
          targetType: "membership",
        });
        return "changed";
      });
    } catch (error) {
      if (error instanceof LastOwnerError) {
        return "last_owner";
      }
      throw error;
    }
  }

  async removeMember(input: {
    actorUserId: string;
    expectedRole: MembershipRole;
    left: boolean;
    membershipId: string;
    organizationId: string;
    targetUserId: string;
  }): Promise<RemoveMemberResult> {
    try {
      return await withDatabaseTransaction(this.pool, async (tx) => {
        if (!(await lockOrganization(tx, input.organizationId))) {
          return "conflict";
        }
        const removed = await removeMembership(tx, {
          expectedRole: input.expectedRole,
          membershipId: input.membershipId,
          organizationId: input.organizationId,
        });
        if (!removed) {
          return "conflict";
        }
        await this.assertOwnerRemains(tx, input);
        await insertAuditLog(tx, {
          action: "member.removed",
          actorUserId: input.actorUserId,
          detail: {
            left: input.left,
            role: input.expectedRole,
            targetUserId: input.targetUserId,
          },
          organizationId: input.organizationId,
          targetId: input.membershipId,
          targetType: "membership",
        });
        return "removed";
      });
    } catch (error) {
      if (error instanceof LastOwnerError) {
        return "last_owner";
      }
      throw error;
    }
  }

  async updateSettings(input: {
    actorUserId: string;
    expectedVersion: number;
    name: string;
    organizationId: string;
  }): Promise<UpdateSettingsResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const previous = await findOrganizationById(tx, input.organizationId);
      if (!previous) {
        return "version_conflict";
      }
      const updated = await updateOrganizationName(tx, {
        expectedVersion: input.expectedVersion,
        name: input.name,
        organizationId: input.organizationId,
      });
      if (!updated) {
        return "version_conflict";
      }

      await insertAuditLog(tx, {
        action: "organization.settings.updated",
        actorUserId: input.actorUserId,
        detail: {
          name: updated.name,
          previousName: previous.name,
          version: updated.version,
        },
        organizationId: input.organizationId,
        targetId: input.organizationId,
        targetType: "organization",
      });
      return updated;
    });
  }

  async deleteOrganization(input: {
    actorUserId: string;
    organizationId: string;
  }): Promise<boolean> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const organization = await findOrganizationById(tx, input.organizationId);
      if (!organization) {
        return false;
      }

      // The delete detaches this row (organization_id set to NULL), so the
      // detail keeps the identifying facts for later investigation.
      await insertAuditLog(tx, {
        action: "organization.deleted",
        actorUserId: input.actorUserId,
        detail: {
          name: organization.name,
          organizationId: organization.id,
          slug: organization.slug,
        },
        organizationId: organization.id,
        targetId: organization.id,
        targetType: "organization",
      });
      return deleteOrganizationById(tx, input.organizationId);
    });
  }

  async listAuditLogs(input: {
    limit: number;
    organizationId: string;
  }): Promise<AuditLogRow[]> {
    return listAuditLogs(this.pool, input);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  /** Roll back owner-affecting writes that leave zero active owners. */
  private async assertOwnerRemains(
    tx: DatabaseExecutor,
    input: { expectedRole: MembershipRole; organizationId: string }
  ): Promise<void> {
    if (input.expectedRole !== "owner") {
      return;
    }
    if ((await countActiveOwners(tx, input.organizationId)) === 0) {
      throw new LastOwnerError();
    }
  }
}

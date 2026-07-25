import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "./outbox.js";

export type MembershipRole =
  "owner" | "admin" | "event_manager" | "finance" | "scanner" | "viewer";

export type MembershipStatus = "invited" | "active" | "removed";

export interface OrganizationRow extends QueryResultRow {
  createdAt: Date;
  id: string;
  name: string;
  slug: string;
  updatedAt: Date;
  version: number;
}

export interface MembershipRow extends QueryResultRow {
  createdAt: Date;
  id: string;
  invitedById: string | null;
  joinedAt: Date | null;
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
  userId: string;
}

export interface OrganizationWithRoleRow extends OrganizationRow {
  role: MembershipRole;
}

export interface InvitationRow extends QueryResultRow {
  createdAt: Date;
  id: string;
  invitedByEmail: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: MembershipRole;
}

export interface MemberRow extends QueryResultRow {
  email: string;
  id: string;
  joinedAt: Date | null;
  role: MembershipRole;
  status: Exclude<MembershipStatus, "removed">;
  userId: string;
}

export interface AuditLogRow extends QueryResultRow {
  action: string;
  actorEmail: string | null;
  actorUserId: string | null;
  createdAt: Date;
  detail: Record<string, unknown>;
  id: string;
  organizationId: string | null;
  targetId: string | null;
  targetType: string;
}

const organizationColumns = `
  "id",
  "name",
  "slug",
  "version",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`;

const membershipColumns = `
  "id",
  "organization_id" AS "organizationId",
  "user_id" AS "userId",
  "role",
  "status",
  "invited_by_id" AS "invitedById",
  "joined_at" AS "joinedAt",
  "created_at" AS "createdAt"
`;

export async function insertOrganization(
  executor: DatabaseExecutor,
  input: { name: string; slug: string }
): Promise<OrganizationRow | null> {
  const result = await executor.query<OrganizationRow>(
    `INSERT INTO "organizations" ("name", "slug")
     VALUES ($1, $2)
     ON CONFLICT ("slug") DO NOTHING
     RETURNING ${organizationColumns}`,
    [input.name, input.slug]
  );
  return result.rows[0] ?? null;
}

export async function findOrganizationById(
  executor: DatabaseExecutor,
  organizationId: string
): Promise<OrganizationRow | null> {
  const result = await executor.query<OrganizationRow>(
    `SELECT ${organizationColumns} FROM "organizations" WHERE "id" = $1`,
    [organizationId]
  );
  return result.rows[0] ?? null;
}

/** Serializes owner-affecting mutations for one organization. */
export async function lockOrganization(
  executor: DatabaseExecutor,
  organizationId: string
): Promise<boolean> {
  const result = await executor.query(
    `SELECT "id" FROM "organizations" WHERE "id" = $1 FOR UPDATE`,
    [organizationId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateOrganizationName(
  executor: DatabaseExecutor,
  input: { expectedVersion: number; name: string; organizationId: string }
): Promise<OrganizationRow | null> {
  const result = await executor.query<OrganizationRow>(
    `UPDATE "organizations"
     SET "name" = $2, "version" = "version" + 1,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "version" = $3
     RETURNING ${organizationColumns}`,
    [input.organizationId, input.name, input.expectedVersion]
  );
  return result.rows[0] ?? null;
}

export async function deleteOrganizationById(
  executor: DatabaseExecutor,
  organizationId: string
): Promise<boolean> {
  const result = await executor.query(
    `DELETE FROM "organizations" WHERE "id" = $1`,
    [organizationId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function insertActiveOwnerMembership(
  executor: DatabaseExecutor,
  input: { organizationId: string; userId: string }
): Promise<MembershipRow> {
  const result = await executor.query<MembershipRow>(
    `INSERT INTO "organization_memberships"
       ("organization_id", "user_id", "role", "status", "joined_at")
     VALUES ($1, $2, 'owner', 'active', CURRENT_TIMESTAMP)
     RETURNING ${membershipColumns}`,
    [input.organizationId, input.userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("The owner membership insert returned no row.");
  }
  return row;
}

/**
 * Creates or revives an invitation. Returns null when the user already has a
 * live (invited or active) membership.
 */
export async function upsertInvitation(
  executor: DatabaseExecutor,
  input: {
    invitedById: string;
    organizationId: string;
    role: MembershipRole;
    userId: string;
  }
): Promise<MembershipRow | null> {
  const result = await executor.query<MembershipRow>(
    `INSERT INTO "organization_memberships"
       ("organization_id", "user_id", "role", "status", "invited_by_id")
     VALUES ($1, $2, $3, 'invited', $4)
     ON CONFLICT ("organization_id", "user_id") DO UPDATE
     SET "role" = EXCLUDED."role",
         "status" = 'invited',
         "invited_by_id" = EXCLUDED."invited_by_id",
         "joined_at" = NULL,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "organization_memberships"."status" = 'removed'
     RETURNING ${membershipColumns}`,
    [input.organizationId, input.userId, input.role, input.invitedById]
  );
  return result.rows[0] ?? null;
}

export async function findMembershipByUser(
  executor: DatabaseExecutor,
  input: { organizationId: string; userId: string }
): Promise<MembershipRow | null> {
  const result = await executor.query<MembershipRow>(
    `SELECT ${membershipColumns} FROM "organization_memberships"
     WHERE "organization_id" = $1 AND "user_id" = $2`,
    [input.organizationId, input.userId]
  );
  return result.rows[0] ?? null;
}

export async function findMembershipById(
  executor: DatabaseExecutor,
  input: { membershipId: string; organizationId: string }
): Promise<MembershipRow | null> {
  const result = await executor.query<MembershipRow>(
    `SELECT ${membershipColumns} FROM "organization_memberships"
     WHERE "id" = $1 AND "organization_id" = $2`,
    [input.membershipId, input.organizationId]
  );
  return result.rows[0] ?? null;
}

export async function listOrganizationsForUser(
  executor: DatabaseExecutor,
  userId: string
): Promise<OrganizationWithRoleRow[]> {
  const result = await executor.query<OrganizationWithRoleRow>(
    `SELECT
       o."id",
       o."name",
       o."slug",
       o."version",
       o."created_at" AS "createdAt",
       o."updated_at" AS "updatedAt",
       m."role"
     FROM "organizations" o
     JOIN "organization_memberships" m ON m."organization_id" = o."id"
     WHERE m."user_id" = $1 AND m."status" = 'active'
     ORDER BY o."name", o."id"`,
    [userId]
  );
  return result.rows;
}

export async function listInvitationsForUser(
  executor: DatabaseExecutor,
  userId: string
): Promise<InvitationRow[]> {
  const result = await executor.query<InvitationRow>(
    `SELECT
       m."id",
       m."role",
       m."created_at" AS "createdAt",
       o."id" AS "organizationId",
       o."name" AS "organizationName",
       o."slug" AS "organizationSlug",
       u."email" AS "invitedByEmail"
     FROM "organization_memberships" m
     JOIN "organizations" o ON o."id" = m."organization_id"
     LEFT JOIN "users" u ON u."id" = m."invited_by_id"
     WHERE m."user_id" = $1 AND m."status" = 'invited'
     ORDER BY m."created_at" DESC, m."id"`,
    [userId]
  );
  return result.rows;
}

export async function listMembers(
  executor: DatabaseExecutor,
  organizationId: string
): Promise<MemberRow[]> {
  const result = await executor.query<MemberRow>(
    `SELECT
       m."id",
       m."user_id" AS "userId",
       u."email",
       m."role",
       m."status",
       m."joined_at" AS "joinedAt"
     FROM "organization_memberships" m
     JOIN "users" u ON u."id" = m."user_id"
     WHERE m."organization_id" = $1 AND m."status" <> 'removed'
     ORDER BY (m."status" = 'active') DESC, u."email", m."id"`,
    [organizationId]
  );
  return result.rows;
}

export async function acceptInvitation(
  executor: DatabaseExecutor,
  input: { membershipId: string; userId: string }
): Promise<MembershipRow | null> {
  const result = await executor.query<MembershipRow>(
    `UPDATE "organization_memberships"
     SET "status" = 'active', "joined_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "user_id" = $2 AND "status" = 'invited'
     RETURNING ${membershipColumns}`,
    [input.membershipId, input.userId]
  );
  return result.rows[0] ?? null;
}

export async function declineInvitation(
  executor: DatabaseExecutor,
  input: { membershipId: string; userId: string }
): Promise<MembershipRow | null> {
  const result = await executor.query<MembershipRow>(
    `UPDATE "organization_memberships"
     SET "status" = 'removed', "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "user_id" = $2 AND "status" = 'invited'
     RETURNING ${membershipColumns}`,
    [input.membershipId, input.userId]
  );
  return result.rows[0] ?? null;
}

/** Compare-and-swap on the current role so stale updates fail safely. */
export async function updateMembershipRole(
  executor: DatabaseExecutor,
  input: {
    expectedRole: MembershipRole;
    membershipId: string;
    organizationId: string;
    role: MembershipRole;
  }
): Promise<MembershipRow | null> {
  const result = await executor.query<MembershipRow>(
    `UPDATE "organization_memberships"
     SET "role" = $3, "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2
       AND "role" = $4 AND "status" <> 'removed'
     RETURNING ${membershipColumns}`,
    [input.membershipId, input.organizationId, input.role, input.expectedRole]
  );
  return result.rows[0] ?? null;
}

export async function removeMembership(
  executor: DatabaseExecutor,
  input: {
    expectedRole: MembershipRole;
    membershipId: string;
    organizationId: string;
  }
): Promise<MembershipRow | null> {
  const result = await executor.query<MembershipRow>(
    `UPDATE "organization_memberships"
     SET "status" = 'removed', "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2
       AND "role" = $3 AND "status" <> 'removed'
     RETURNING ${membershipColumns}`,
    [input.membershipId, input.organizationId, input.expectedRole]
  );
  return result.rows[0] ?? null;
}

export async function countActiveOwners(
  executor: DatabaseExecutor,
  organizationId: string
): Promise<number> {
  const result = await executor.query<{ count: number } & QueryResultRow>(
    `SELECT count(*)::int AS "count" FROM "organization_memberships"
     WHERE "organization_id" = $1 AND "role" = 'owner' AND "status" = 'active'`,
    [organizationId]
  );
  return result.rows[0]?.count ?? 0;
}

export async function insertAuditLog(
  executor: DatabaseExecutor,
  input: {
    action: string;
    actorUserId: string | null;
    detail: Record<string, unknown>;
    organizationId: string | null;
    targetId: string | null;
    targetType: string;
  }
): Promise<void> {
  await executor.query(
    `INSERT INTO "audit_logs"
       ("organization_id", "actor_user_id", "action", "target_type",
        "target_id", "detail")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.organizationId,
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      JSON.stringify(input.detail),
    ]
  );
}

export async function listAuditLogs(
  executor: DatabaseExecutor,
  input: { limit: number; organizationId: string }
): Promise<AuditLogRow[]> {
  const result = await executor.query<AuditLogRow>(
    `SELECT
       a."id",
       a."organization_id" AS "organizationId",
       a."actor_user_id" AS "actorUserId",
       u."email" AS "actorEmail",
       a."action",
       a."target_type" AS "targetType",
       a."target_id" AS "targetId",
       a."detail",
       a."created_at" AS "createdAt"
     FROM "audit_logs" a
     LEFT JOIN "users" u ON u."id" = a."actor_user_id"
     WHERE a."organization_id" = $1
     ORDER BY a."created_at" DESC, a."id"
     LIMIT $2`,
    [input.organizationId, input.limit]
  );
  return result.rows;
}

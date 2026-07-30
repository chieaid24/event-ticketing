import { z } from "zod";

import { emailSchema } from "./auth.js";

export const membershipRoleSchema = z.enum([
  "owner",
  "admin",
  "event_manager",
  "finance",
  "scanner",
  "viewer",
]);

export const organizationPermissionSchema = z.enum([
  "organization.read",
  "organization.settings.update",
  "organization.delete",
  "members.read",
  "members.invite",
  "members.role.update",
  "members.remove",
  "audit.read",
  "venues.manage",
  "events.manage",
  "finance.manage",
  "scanner.checkin",
  "scanner.reverse",
]);

export const organizationNameSchema = z.string().trim().min(3).max(160);

export const organizationSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const createOrganizationRequestSchema = z
  .object({
    name: organizationNameSchema,
    slug: organizationSlugSchema,
  })
  .strict();

export const updateOrganizationSettingsRequestSchema = z
  .object({
    name: organizationNameSchema,
    version: z.number().int().min(1),
  })
  .strict();

export const deleteOrganizationRequestSchema = z
  .object({
    confirmSlug: z.string().trim().min(1).max(80),
  })
  .strict();

export const inviteMemberRequestSchema = z
  .object({
    email: emailSchema,
    role: membershipRoleSchema,
  })
  .strict();

export const changeMemberRoleRequestSchema = z
  .object({
    // The role the caller last saw; the change is rejected when it is stale.
    expectedRole: membershipRoleSchema,
    role: membershipRoleSchema,
  })
  .strict();

export const organizationSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    version: z.number().int(),
  })
  .strict();

export const membershipContextSchema = z
  .object({
    assignableRoles: z.array(membershipRoleSchema),
    permissions: z.array(organizationPermissionSchema),
    role: membershipRoleSchema,
  })
  .strict();

export const organizationDetailResponseSchema = z
  .object({
    membership: membershipContextSchema,
    organization: organizationSchema,
  })
  .strict();

export const organizationSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    role: membershipRoleSchema,
    slug: z.string(),
  })
  .strict();

export const invitationSummarySchema = z
  .object({
    createdAt: z.iso.datetime(),
    invitedByEmail: z.string().nullable(),
    membershipId: z.uuid(),
    organization: z
      .object({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
      })
      .strict(),
    role: membershipRoleSchema,
  })
  .strict();

export const organizationListResponseSchema = z
  .object({
    invitations: z.array(invitationSummarySchema),
    organizations: z.array(organizationSummarySchema),
  })
  .strict();

export const memberSchema = z
  .object({
    email: z.string(),
    joinedAt: z.iso.datetime().nullable(),
    membershipId: z.uuid(),
    role: membershipRoleSchema,
    status: z.enum(["invited", "active"]),
    userId: z.uuid(),
  })
  .strict();

export const memberListResponseSchema = z
  .object({
    members: z.array(memberSchema),
  })
  .strict();

export const auditLogEntrySchema = z
  .object({
    action: z.string(),
    actorEmail: z.string().nullable(),
    createdAt: z.iso.datetime(),
    detail: z.record(z.string(), z.unknown()),
    id: z.uuid(),
    targetId: z.uuid().nullable(),
    targetType: z.string(),
  })
  .strict();

export const auditLogListResponseSchema = z
  .object({
    entries: z.array(auditLogEntrySchema),
  })
  .strict();

export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type OrganizationPermission = z.infer<
  typeof organizationPermissionSchema
>;
export type CreateOrganizationRequest = z.infer<
  typeof createOrganizationRequestSchema
>;
export type UpdateOrganizationSettingsRequest = z.infer<
  typeof updateOrganizationSettingsRequestSchema
>;
export type DeleteOrganizationRequest = z.infer<
  typeof deleteOrganizationRequestSchema
>;
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;
export type ChangeMemberRoleRequest = z.infer<
  typeof changeMemberRoleRequestSchema
>;
export type Organization = z.infer<typeof organizationSchema>;
export type MembershipContext = z.infer<typeof membershipContextSchema>;
export type OrganizationDetailResponse = z.infer<
  typeof organizationDetailResponseSchema
>;
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type InvitationSummary = z.infer<typeof invitationSummarySchema>;
export type OrganizationListResponse = z.infer<
  typeof organizationListResponseSchema
>;
export type Member = z.infer<typeof memberSchema>;
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

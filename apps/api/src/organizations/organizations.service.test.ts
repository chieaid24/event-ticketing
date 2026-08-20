import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type {
  AuditLogRow,
  InvitationRow,
  MembershipRole,
  MembershipRow,
  MemberRow,
  OrganizationRow,
  OrganizationWithRoleRow,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { OrganizationsService } from "./organizations.service.js";
import type {
  CreateOrganizationResult,
  InvitationResponse,
  InviteMemberResult,
  OrganizationsStore,
  RemoveMemberResult,
  RoleChangeResult,
  UpdateSettingsResult,
} from "./organizations.store.js";

const context: RequestAuthContext = {
  csrfToken: "a-valid-csrf-token-value",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "a-valid-session-secret-value",
};

function makeSession(userId: string): AuthenticatedSession {
  return {
    session: {
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      csrfTokenHash: "0".repeat(64),
      deviceSummary: "test",
      id: randomUUID(),
      lastSeenAt: new Date(),
      revokedAt: null,
      tokenHash: "0".repeat(64),
      userId,
    },
    user: {
      createdAt: new Date(),
      email: "actor@example.test",
      emailVerifiedAt: new Date(),
      id: userId,
      passwordHash: null,
      platformRole: "customer",
      status: "active",
    },
  };
}

class FakeAuth {
  csrfValid = true;

  constructor(private readonly authenticated: AuthenticatedSession) {}

  async requireSession(): Promise<AuthenticatedSession> {
    return this.authenticated;
  }

  async requireMutationSession(): Promise<AuthenticatedSession> {
    if (!this.csrfValid) {
      throw new HttpException(
        { code: "invalid_csrf_token", message: "The CSRF token is invalid." },
        403
      );
    }
    return this.authenticated;
  }
}

function makeOrganization(
  overrides: Partial<OrganizationRow> = {}
): OrganizationRow {
  return {
    createdAt: new Date(),
    id: randomUUID(),
    name: "Example Test Box Office",
    slug: "example-test-box-office",
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

function makeMembership(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    createdAt: new Date(),
    id: randomUUID(),
    invitedById: null,
    joinedAt: new Date(),
    organizationId: randomUUID(),
    role: "owner",
    status: "active",
    userId: randomUUID(),
    ...overrides,
  };
}

class FakeOrganizationsStore implements OrganizationsStore {
  auditLogs: AuditLogRow[] = [];
  changeRoleCalls: unknown[] = [];
  changeRoleResult: RoleChangeResult = "changed";
  createResult: CreateOrganizationResult | null = null;
  deleteCalls: unknown[] = [];
  deleteResult = true;
  inviteCalls: { email: string; role: MembershipRole }[] = [];
  inviteResult: InviteMemberResult = "invited";
  invitations: InvitationRow[] = [];
  members: MemberRow[] = [];
  memberships: MembershipRow[] = [];
  organizations: OrganizationRow[] = [];
  organizationsWithRole: OrganizationWithRoleRow[] = [];
  removeCalls: { expectedRole: MembershipRole; left: boolean }[] = [];
  removeResult: RemoveMemberResult = "removed";
  respondCalls: { membershipId: string; response: InvitationResponse }[] = [];
  respondResult: InvitationResponse | null = "accept";
  settingsResult: UpdateSettingsResult = makeOrganization();

  async createOrganization(input: {
    actorUserId: string;
    name: string;
    slug: string;
  }): Promise<CreateOrganizationResult> {
    if (this.createResult) {
      return this.createResult;
    }
    const organization = makeOrganization({
      name: input.name,
      slug: input.slug,
    });
    return {
      membership: makeMembership({
        organizationId: organization.id,
        userId: input.actorUserId,
      }),
      organization,
    };
  }

  async listForUser(): Promise<{
    invitations: InvitationRow[];
    organizations: OrganizationWithRoleRow[];
  }> {
    return {
      invitations: this.invitations,
      organizations: this.organizationsWithRole,
    };
  }

  async findOrganization(
    organizationId: string
  ): Promise<OrganizationRow | null> {
    return this.organizations.find((row) => row.id === organizationId) ?? null;
  }

  async findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null> {
    return (
      this.memberships.find(
        (row) =>
          row.organizationId === input.organizationId &&
          row.userId === input.userId
      ) ?? null
    );
  }

  async findMembershipById(input: {
    membershipId: string;
    organizationId: string;
  }): Promise<MembershipRow | null> {
    return (
      this.memberships.find(
        (row) =>
          row.id === input.membershipId &&
          row.organizationId === input.organizationId
      ) ?? null
    );
  }

  async listMembers(): Promise<MemberRow[]> {
    return this.members;
  }

  async inviteMember(input: {
    actorUserId: string;
    email: string;
    organizationId: string;
    role: MembershipRole;
  }): Promise<InviteMemberResult> {
    this.inviteCalls.push({ email: input.email, role: input.role });
    return this.inviteResult;
  }

  async respondToInvitation(input: {
    membershipId: string;
    response: InvitationResponse;
    userId: string;
  }): Promise<InvitationResponse | null> {
    this.respondCalls.push({
      membershipId: input.membershipId,
      response: input.response,
    });
    return this.respondResult;
  }

  async changeMemberRole(input: unknown): Promise<RoleChangeResult> {
    this.changeRoleCalls.push(input);
    return this.changeRoleResult;
  }

  async removeMember(input: {
    actorUserId: string;
    expectedRole: MembershipRole;
    left: boolean;
    membershipId: string;
    organizationId: string;
    targetUserId: string;
  }): Promise<RemoveMemberResult> {
    this.removeCalls.push({
      expectedRole: input.expectedRole,
      left: input.left,
    });
    return this.removeResult;
  }

  async updateSettings(): Promise<UpdateSettingsResult> {
    return this.settingsResult;
  }

  async deleteOrganization(input: unknown): Promise<boolean> {
    this.deleteCalls.push(input);
    return this.deleteResult;
  }

  async listAuditLogs(): Promise<AuditLogRow[]> {
    return this.auditLogs;
  }
}

interface Scenario {
  auth: FakeAuth;
  organizationId: string;
  service: OrganizationsService;
  store: FakeOrganizationsStore;
  userId: string;
}

// store seeded with one org and actor as a member
function makeScenario(actorRole: MembershipRole | null): Scenario {
  const userId = randomUUID();
  const store = new FakeOrganizationsStore();
  const organization = makeOrganization();
  store.organizations.push(organization);
  if (actorRole) {
    store.memberships.push(
      makeMembership({
        organizationId: organization.id,
        role: actorRole,
        userId,
      })
    );
  }
  const auth = new FakeAuth(makeSession(userId));
  return {
    auth,
    organizationId: organization.id,
    service: new OrganizationsService(auth, store),
    store,
    userId,
  };
}

async function expectHttpError(
  work: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  try {
    await work;
    expect.fail(`Expected an HTTP ${String(status)} ${code} error.`);
  } catch (error) {
    if (!(error instanceof HttpException)) {
      throw error;
    }
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  }
}

describe("OrganizationsService createOrganization", () => {
  it("returns the owner membership context", async () => {
    const { service } = makeScenario(null);
    const result = await service.createOrganization(context, {
      name: "Riverside Concert Hall",
      slug: "riverside-concert-hall",
    });
    expect(result.membership.role).toBe("owner");
    expect(result.membership.permissions).toContain("organization.delete");
    expect(result.organization.slug).toBe("riverside-concert-hall");
  });

  it("maps a taken slug onto a conflict", async () => {
    const { service, store } = makeScenario(null);
    store.createResult = "slug_taken";
    await expectHttpError(
      service.createOrganization(context, {
        name: "Riverside Concert Hall",
        slug: "riverside-concert-hall",
      }),
      409,
      "slug_taken"
    );
  });

  it("rejects an invalid slug before touching the store", async () => {
    const { service } = makeScenario(null);
    await expectHttpError(
      service.createOrganization(context, {
        name: "Riverside Concert Hall",
        slug: "Not A Slug",
      }),
      400,
      "invalid_request"
    );
  });

  it("propagates a CSRF failure", async () => {
    const { auth, service } = makeScenario(null);
    auth.csrfValid = false;
    await expectHttpError(
      service.createOrganization(context, {
        name: "Riverside Concert Hall",
        slug: "riverside-concert-hall",
      }),
      403,
      "invalid_csrf_token"
    );
  });
});

describe("OrganizationsService organization scoping", () => {
  it("answers 404 for a non-member, matching a missing organization", async () => {
    const { organizationId, service } = makeScenario(null);
    await expectHttpError(
      service.getOrganization(context, organizationId),
      404,
      "organization_not_found"
    );
  });

  it("answers 404 for an invited but not accepted member", async () => {
    const scenario = makeScenario("viewer");
    const membership = scenario.store.memberships[0]!;
    membership.status = "invited";
    await expectHttpError(
      scenario.service.getOrganization(context, scenario.organizationId),
      404,
      "organization_not_found"
    );
  });

  it("answers 404 for a malformed organization id", async () => {
    const { service } = makeScenario(null);
    await expectHttpError(
      service.getOrganization(context, "not-a-uuid"),
      404,
      "organization_not_found"
    );
  });

  it("returns role, permissions, and assignable roles for a member", async () => {
    const { organizationId, service } = makeScenario("event_manager");
    const detail = await service.getOrganization(context, organizationId);
    expect(detail.membership.role).toBe("event_manager");
    expect(detail.membership.permissions).toEqual([
      "organization.read",
      "members.read",
      "analytics.read",
      "venues.manage",
      "events.manage",
    ]);
    expect(detail.membership.assignableRoles).toEqual([]);
  });
});

describe("OrganizationsService member listing", () => {
  it("denies a scanner the member roster", async () => {
    const { organizationId, service } = makeScenario("scanner");
    await expectHttpError(
      service.listMembers(context, organizationId),
      403,
      "forbidden"
    );
  });

  it("lets a viewer read the roster", async () => {
    const { organizationId, service, store } = makeScenario("viewer");
    store.members = [
      {
        email: "owner@example.test",
        id: randomUUID(),
        joinedAt: new Date(),
        role: "owner",
        status: "active",
        userId: randomUUID(),
      },
    ];
    const result = await service.listMembers(context, organizationId);
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.role).toBe("owner");
  });
});

describe("OrganizationsService inviteMember", () => {
  it("denies a viewer", async () => {
    const { organizationId, service } = makeScenario("viewer");
    await expectHttpError(
      service.inviteMember(context, organizationId, {
        email: "guest@example.test",
        role: "viewer",
      }),
      403,
      "forbidden"
    );
  });

  it("blocks an admin from inviting an owner", async () => {
    const { organizationId, service, store } = makeScenario("admin");
    await expectHttpError(
      service.inviteMember(context, organizationId, {
        email: "guest@example.test",
        role: "owner",
      }),
      403,
      "role_not_assignable"
    );
    expect(store.inviteCalls).toHaveLength(0);
  });

  it("stays generic when the email has no account", async () => {
    const { organizationId, service, store } = makeScenario("owner");
    store.inviteResult = "skipped";
    const result = await service.inviteMember(context, organizationId, {
      email: "nobody@example.test",
      role: "viewer",
    });
    expect(result).toEqual({ status: "accepted" });
  });
});

describe("OrganizationsService respondToInvitation", () => {
  it("accepts an invitation for the session user", async () => {
    const { service, store } = makeScenario(null);
    const membershipId = randomUUID();
    const result = await service.respondToInvitation(
      context,
      membershipId,
      "accept"
    );
    expect(result).toEqual({ status: "accepted" });
    expect(store.respondCalls).toEqual([{ membershipId, response: "accept" }]);
  });

  it("answers 404 when the invitation is not addressed to the user", async () => {
    const { service, store } = makeScenario(null);
    store.respondResult = null;
    await expectHttpError(
      service.respondToInvitation(context, randomUUID(), "accept"),
      404,
      "invitation_not_found"
    );
  });
});

describe("OrganizationsService changeMemberRole", () => {
  function withTarget(scenario: Scenario, role: MembershipRole): MembershipRow {
    const target = makeMembership({
      organizationId: scenario.organizationId,
      role,
    });
    scenario.store.memberships.push(target);
    return target;
  }

  it("blocks changing your own role", async () => {
    const scenario = makeScenario("owner");
    const own = scenario.store.memberships[0]!;
    await expectHttpError(
      scenario.service.changeMemberRole(
        context,
        scenario.organizationId,
        own.id,
        { expectedRole: "owner", role: "viewer" }
      ),
      403,
      "cannot_change_own_role"
    );
  });

  it("blocks an admin from managing an owner", async () => {
    const scenario = makeScenario("admin");
    const target = withTarget(scenario, "owner");
    await expectHttpError(
      scenario.service.changeMemberRole(
        context,
        scenario.organizationId,
        target.id,
        { expectedRole: "owner", role: "viewer" }
      ),
      403,
      "forbidden"
    );
  });

  it("blocks an admin from granting admin", async () => {
    const scenario = makeScenario("admin");
    const target = withTarget(scenario, "viewer");
    await expectHttpError(
      scenario.service.changeMemberRole(
        context,
        scenario.organizationId,
        target.id,
        { expectedRole: "viewer", role: "admin" }
      ),
      403,
      "role_not_assignable"
    );
  });

  it("rejects a stale expected role", async () => {
    const scenario = makeScenario("owner");
    const target = withTarget(scenario, "finance");
    await expectHttpError(
      scenario.service.changeMemberRole(
        context,
        scenario.organizationId,
        target.id,
        { expectedRole: "viewer", role: "admin" }
      ),
      409,
      "membership_conflict"
    );
    expect(scenario.store.changeRoleCalls).toHaveLength(0);
  });

  it("surfaces the last-owner protection", async () => {
    const scenario = makeScenario("owner");
    const target = withTarget(scenario, "owner");
    scenario.store.changeRoleResult = "last_owner";
    await expectHttpError(
      scenario.service.changeMemberRole(
        context,
        scenario.organizationId,
        target.id,
        { expectedRole: "owner", role: "viewer" }
      ),
      409,
      "last_owner"
    );
  });

  it("answers 404 for a membership from another organization", async () => {
    const scenario = makeScenario("owner");
    const foreign = makeMembership({ role: "viewer" });
    scenario.store.memberships.push(foreign);
    await expectHttpError(
      scenario.service.changeMemberRole(
        context,
        scenario.organizationId,
        foreign.id,
        { expectedRole: "viewer", role: "finance" }
      ),
      404,
      "member_not_found"
    );
  });
});

describe("OrganizationsService removeMember", () => {
  it("lets any member leave", async () => {
    const scenario = makeScenario("viewer");
    const own = scenario.store.memberships[0]!;
    const result = await scenario.service.removeMember(
      context,
      scenario.organizationId,
      own.id
    );
    expect(result).toEqual({ status: "accepted" });
    expect(scenario.store.removeCalls).toEqual([
      { expectedRole: "viewer", left: true },
    ]);
  });

  it("blocks a viewer from removing someone else", async () => {
    const scenario = makeScenario("viewer");
    const target = makeMembership({
      organizationId: scenario.organizationId,
      role: "scanner",
    });
    scenario.store.memberships.push(target);
    await expectHttpError(
      scenario.service.removeMember(
        context,
        scenario.organizationId,
        target.id
      ),
      403,
      "forbidden"
    );
  });

  it("keeps the last owner in place", async () => {
    const scenario = makeScenario("owner");
    const own = scenario.store.memberships[0]!;
    scenario.store.removeResult = "last_owner";
    await expectHttpError(
      scenario.service.removeMember(context, scenario.organizationId, own.id),
      409,
      "last_owner"
    );
  });
});

describe("OrganizationsService settings and deletion", () => {
  it("denies settings updates below admin", async () => {
    const { organizationId, service } = makeScenario("finance");
    await expectHttpError(
      service.updateSettings(context, organizationId, {
        name: "Renamed Hall",
        version: 1,
      }),
      403,
      "forbidden"
    );
  });

  it("maps a stale version onto a conflict", async () => {
    const { organizationId, service, store } = makeScenario("owner");
    store.settingsResult = "version_conflict";
    await expectHttpError(
      service.updateSettings(context, organizationId, {
        name: "Renamed Hall",
        version: 1,
      }),
      409,
      "version_conflict"
    );
  });

  it("denies deletion to admins", async () => {
    const { organizationId, service } = makeScenario("admin");
    await expectHttpError(
      service.deleteOrganization(context, organizationId, {
        confirmSlug: "example-test-box-office",
      }),
      403,
      "forbidden"
    );
  });

  it("requires the exact slug as confirmation", async () => {
    const { organizationId, service, store } = makeScenario("owner");
    await expectHttpError(
      service.deleteOrganization(context, organizationId, {
        confirmSlug: "wrong-slug",
      }),
      400,
      "confirmation_mismatch"
    );
    expect(store.deleteCalls).toHaveLength(0);
  });

  it("deletes after owner confirmation", async () => {
    const { organizationId, service, store } = makeScenario("owner");
    const result = await service.deleteOrganization(context, organizationId, {
      confirmSlug: "example-test-box-office",
    });
    expect(result).toEqual({ status: "accepted" });
    expect(store.deleteCalls).toHaveLength(1);
  });
});

describe("OrganizationsService audit logs", () => {
  it("denies audit access below admin", async () => {
    const { organizationId, service } = makeScenario("event_manager");
    await expectHttpError(
      service.listAuditLogs(context, organizationId),
      403,
      "forbidden"
    );
  });

  it("maps audit rows for an admin", async () => {
    const { organizationId, service, store } = makeScenario("admin");
    store.auditLogs = [
      {
        action: "member.invited",
        actorEmail: "owner@example.test",
        actorUserId: randomUUID(),
        createdAt: new Date(),
        detail: { role: "viewer" },
        id: randomUUID(),
        organizationId,
        targetId: randomUUID(),
        targetType: "membership",
      },
    ];
    const result = await service.listAuditLogs(context, organizationId);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.action).toBe("member.invited");
    expect(result.entries[0]?.detail).toEqual({ role: "viewer" });
  });
});

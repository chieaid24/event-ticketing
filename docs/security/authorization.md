# Organization Authorization Policy

This is the documented policy that `apps/api/src/organizations/policy.ts`
implements. Change both in the same pull request.

The API is the enforcement point. Frontend visibility mirrors this policy for
usability and never replaces it. Non-members receive the same `404` as a missing
organization so probing cannot confirm one exists.

## Roles and permissions

| Permission                     | Owner | Admin | Event manager | Finance | Scanner | Viewer |
| ------------------------------ | ----- | ----- | ------------- | ------- | ------- | ------ |
| `organization.read`            | yes   | yes   | yes           | yes     | yes     | yes    |
| `organization.settings.update` | yes   | yes   | no            | no      | no      | no     |
| `organization.delete`          | yes   | no    | no            | no      | no      | no     |
| `members.read`                 | yes   | yes   | yes           | yes     | no      | yes    |
| `members.invite`               | yes   | yes   | no            | no      | no      | no     |
| `members.role.update`          | yes   | yes   | no            | no      | no      | no     |
| `members.remove`               | yes   | yes   | no            | no      | no      | no     |
| `audit.read`                   | yes   | yes   | no            | no      | no      | no     |
| `events.manage`                | yes   | yes   | yes           | no      | no      | no     |
| `finance.manage`               | yes   | yes   | no            | yes     | no      | no     |
| `scanner.checkin`              | yes   | yes   | no            | no      | yes     | no     |

## Role management rules

- An owner may grant any role and manage a member of any role.
- An admin may grant and manage only `event_manager`, `finance`, `scanner`, and
  `viewer`. Admins cannot touch owners or other admins and cannot grant `admin`
  or `owner`.
- Nobody changes their own role; another owner must do it.
- Any member may leave an organization.
- Every organization keeps at least one active owner. Changes or removals that
  would drop the last owner fail with `last_owner`.

## Safeguards

- Role changes carry the role the caller last saw (`expectedRole`) and fail with
  `membership_conflict` when it is stale. Settings updates carry a `version` and
  fail with `version_conflict` the same way.
- Deleting an organization is owner-only, requires retyping the organization
  slug, and requires a current CSRF-checked session.
- Invitations answer `202` whether or not the email has an account, so the
  invite flow cannot enumerate users. Invitations become visible to the invited
  person after they sign in.

## Audit

Membership and organization mutations write an `audit_logs` row in the same
transaction: `organization.created`, `organization.settings.updated`,
`organization.deleted`, `member.invited`, `member.joined`,
`member.invitation.declined`, `member.role.changed`, and `member.removed` (with
a `left` flag when the member removed themselves). Entries keep the actor,
target, and a small detail object, and survive actor or organization deletion
through `SET NULL` foreign keys. Owners and admins read them at
`GET /organizations/:id/audit-logs`.

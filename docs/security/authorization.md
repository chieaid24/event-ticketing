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
| `venues.manage`                | yes   | yes   | yes           | no      | no      | no     |
| `events.manage`                | yes   | yes   | yes           | no      | no      | no     |
| `finance.manage`               | yes   | yes   | no            | yes     | no      | no     |
| `scanner.checkin`              | yes   | yes   | no            | no      | yes     | no     |
| `scanner.reverse`              | yes   | yes   | no            | no      | no      | no     |

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
- Venue reads need an active membership; venue mutations need `venues.manage`
  and carry the venue `version`. Layout replacement is validated against the
  shared layout contract and semantic rules before any write, and the version
  compare-and-swap serializes concurrent replacements to one winner. A venue
  addressed through the wrong organization answers the same `404` as a missing
  venue.
- Event reads need an active membership; event mutations need `events.manage`
  and carry the event `version`. Only a draft accepts edits. Publication runs
  the shared `validateEventForPublication` check server-side, rejects an
  incomplete or inconsistent event, and snapshots the venue seats so later
  layout edits never change sold inventory. The version compare-and-swap
  serializes concurrent draft writes and publication to one winner.
- Deleting an organization is owner-only, requires retyping the organization
  slug, and requires a current CSRF-checked session.
- Scanner check-in needs `scanner.checkin`; reversing a check-in needs
  `scanner.reverse` and a stated reason, so the scanner role can admit but never
  undo. A ticket outside the addressed organization and event answers as an
  invalid scan or a missing ticket, never as another tenant's data.
- Invitations answer `202` whether or not the email has an account, so the
  invite flow cannot enumerate users. Invitations become visible to the invited
  person after they sign in.

## Audit

Membership and organization mutations write an `audit_logs` row in the same
transaction: `organization.created`, `organization.settings.updated`,
`organization.deleted`, `member.invited`, `member.joined`,
`member.invitation.declined`, `member.role.changed`, `member.removed` (with a
`left` flag when the member removed themselves), `venue.created`,
`venue.updated`, `venue.layout.replaced`, `venue.deleted`, `event.created`,
`event.updated`, `event.ticket_types.replaced`, `event.published`,
`ticket.checked_in`, and `ticket.checkin_reversed`. Entries keep the actor,
target, and a small detail object, and survive actor or organization deletion
through `SET NULL` foreign keys. Owners and admins read them at
`GET /organizations/:id/audit-logs`.

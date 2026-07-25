import type { MembershipRole } from "@event-ticketing/contracts";

export const roleLabels: Readonly<Record<MembershipRole, string>> = {
  admin: "Admin",
  event_manager: "Event manager",
  finance: "Finance",
  owner: "Owner",
  scanner: "Scanner",
  viewer: "Viewer",
};

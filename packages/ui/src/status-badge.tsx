import type { ReactNode } from "react";

export interface StatusBadgeProps {
  children?: ReactNode;
  status: "available" | "unavailable";
}

export function StatusBadge({ children, status }: StatusBadgeProps): ReactNode {
  const label = status === "available" ? "Available" : "Unavailable";

  return (
    <span className="status-badge" data-status={status}>
      <span aria-hidden="true" className="status-badge__indicator">
        {status === "available" ? "OK" : "!"}
      </span>
      <span className="sr-only">Service status: </span>
      {children ?? label}
    </span>
  );
}

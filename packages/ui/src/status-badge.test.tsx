import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./status-badge.js";

describe("StatusBadge", () => {
  it("renders a text status and a non-color indicator", () => {
    const markup = renderToStaticMarkup(
      <StatusBadge status="available">API connected</StatusBadge>
    );

    expect(markup).toContain('data-status="available"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Service status: ");
    expect(markup).toContain("API connected");
  });
});

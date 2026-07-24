import { describe, expect, it } from "vitest";

import { statusResponseSchema } from "@event-ticketing/contracts";

import { StatusController } from "./status.controller.js";

describe("StatusController", () => {
  it("returns the shared public status contract", () => {
    const response = new StatusController().status();

    expect(statusResponseSchema.parse(response)).toEqual({
      service: "api",
      status: "available",
      version: 1,
    });
  });
});

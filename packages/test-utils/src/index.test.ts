import { describe, expect, it } from "vitest";

import { createDeferred } from "./index.js";

describe("createDeferred", () => {
  it("lets a test release a pending operation", async () => {
    const deferred = createDeferred<string>();

    deferred.resolve("released");

    await expect(deferred.promise).resolves.toBe("released");
  });
});

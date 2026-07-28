import { describe, expect, it, vi } from "vitest";

import {
  cancelHold,
  createAssignedSeatHold,
  createGeneralAdmissionHold,
  HoldEventNotFoundError,
  HoldInputError,
  MAX_SEATS_PER_HOLD,
  type CreateAssignedSeatHoldInput,
  type CreateGeneralAdmissionHoldInput,
  type DatabaseExecutor,
} from "./index.js";

const validItem = {
  quantity: 2,
  ticketTypeId: "11111111-1111-4111-8111-111111111111",
};

function baseInput(
  overrides: Partial<CreateGeneralAdmissionHoldInput> = {}
): CreateGeneralAdmissionHoldInput {
  return {
    actor: { userId: "22222222-2222-4222-8222-222222222222" },
    eventId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "idem-1",
    items: [validItem],
    ...overrides,
  };
}

describe("createGeneralAdmissionHold input", () => {
  it("rejects an empty item list before querying PostgreSQL", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    await expect(
      createGeneralAdmissionHold(executor, baseInput({ items: [] }))
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects a duplicate ticket type", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    await expect(
      createGeneralAdmissionHold(
        executor,
        baseInput({ items: [validItem, { ...validItem }] })
      )
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects a non-positive or non-integer quantity", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    for (const quantity of [0, -1, 1.5, 999999]) {
      await expect(
        createGeneralAdmissionHold(
          executor,
          baseInput({ items: [{ ...validItem, quantity }] })
        )
      ).rejects.toBeInstanceOf(HoldInputError);
    }
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized idempotency key", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    for (const idempotencyKey of ["", "x".repeat(201)]) {
      await expect(
        createGeneralAdmissionHold(executor, baseInput({ idempotencyKey }))
      ).rejects.toBeInstanceOf(HoldInputError);
    }
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("requires exactly one actor", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    await expect(
      createGeneralAdmissionHold(executor, baseInput({ actor: {} }))
    ).rejects.toBeInstanceOf(HoldInputError);
    await expect(
      createGeneralAdmissionHold(
        executor,
        baseInput({ actor: { guestSessionId: "g", userId: "u" } })
      )
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("reports a missing event", async () => {
    const executor: DatabaseExecutor = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };

    await expect(
      createGeneralAdmissionHold(executor, baseInput())
    ).rejects.toBeInstanceOf(HoldEventNotFoundError);
    expect(executor.query).toHaveBeenCalledTimes(1);
  });
});

function assignedInput(
  overrides: Partial<CreateAssignedSeatHoldInput> = {}
): CreateAssignedSeatHoldInput {
  return {
    actor: { userId: "22222222-2222-4222-8222-222222222222" },
    eventId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "idem-seat-1",
    seatIds: ["44444444-4444-4444-8444-444444444444"],
    ...overrides,
  };
}

describe("createAssignedSeatHold input", () => {
  it("rejects an empty seat list before querying PostgreSQL", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    await expect(
      createAssignedSeatHold(executor, assignedInput({ seatIds: [] }))
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects more than the per-hold seat limit", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };
    const seatIds = Array.from(
      { length: MAX_SEATS_PER_HOLD + 1 },
      (_unused, index) => `seat-${index}`
    );

    await expect(
      createAssignedSeatHold(executor, assignedInput({ seatIds }))
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects a duplicate seat", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };
    const seatId = "44444444-4444-4444-8444-444444444444";

    await expect(
      createAssignedSeatHold(
        executor,
        assignedInput({ seatIds: [seatId, seatId] })
      )
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized idempotency key", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    for (const idempotencyKey of ["", "x".repeat(201)]) {
      await expect(
        createAssignedSeatHold(executor, assignedInput({ idempotencyKey }))
      ).rejects.toBeInstanceOf(HoldInputError);
    }
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("requires exactly one actor", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    await expect(
      createAssignedSeatHold(executor, assignedInput({ actor: {} }))
    ).rejects.toBeInstanceOf(HoldInputError);
    await expect(
      createAssignedSeatHold(
        executor,
        assignedInput({ actor: { guestSessionId: "g", userId: "u" } })
      )
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("reports a missing event", async () => {
    const executor: DatabaseExecutor = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };

    await expect(
      createAssignedSeatHold(executor, assignedInput())
    ).rejects.toBeInstanceOf(HoldEventNotFoundError);
    expect(executor.query).toHaveBeenCalledTimes(1);
  });
});

describe("cancelHold input", () => {
  it("requires exactly one actor before querying PostgreSQL", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    await expect(
      cancelHold(executor, {
        actor: {},
        holdId: "44444444-4444-4444-8444-444444444444",
      })
    ).rejects.toBeInstanceOf(HoldInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });
});

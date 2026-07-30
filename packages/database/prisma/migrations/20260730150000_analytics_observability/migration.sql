-- Append-only analytics events and incrementally maintained daily projections.

CREATE TABLE "analytics_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "event_id" UUID,
  "kind" VARCHAR(80) NOT NULL,
  "currency" CHAR(3),
  "amount_minor" INTEGER,
  "quantity" INTEGER,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "source_type" VARCHAR(40) NOT NULL,
  "source_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_events_amount_non_negative"
    CHECK ("amount_minor" IS NULL OR "amount_minor" >= 0),
  CONSTRAINT "analytics_events_quantity_non_negative"
    CHECK ("quantity" IS NULL OR "quantity" >= 0)
);

CREATE UNIQUE INDEX "analytics_events_kind_source_id_key"
  ON "analytics_events"("kind", "source_id");
CREATE INDEX "analytics_events_organization_id_occurred_at_idx"
  ON "analytics_events"("organization_id", "occurred_at");

ALTER TABLE "analytics_events"
  ADD CONSTRAINT "analytics_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "analytics_events"
  ADD CONSTRAINT "analytics_events_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "analytics_daily_financials" (
  "organization_id" UUID NOT NULL,
  "day" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "paid_orders" BIGINT NOT NULL DEFAULT 0,
  "tickets_sold" BIGINT NOT NULL DEFAULT 0,
  "gross_minor" BIGINT NOT NULL DEFAULT 0,
  "fee_minor" BIGINT NOT NULL DEFAULT 0,
  "refund_count" BIGINT NOT NULL DEFAULT 0,
  "refund_minor" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "analytics_daily_financials_pkey"
    PRIMARY KEY ("organization_id", "day", "currency"),
  CONSTRAINT "analytics_daily_financials_non_negative"
    CHECK (
      "paid_orders" >= 0
      AND "tickets_sold" >= 0
      AND "gross_minor" >= 0
      AND "fee_minor" >= 0
      AND "refund_count" >= 0
      AND "refund_minor" >= 0
    )
);

ALTER TABLE "analytics_daily_financials"
  ADD CONSTRAINT "analytics_daily_financials_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "analytics_daily_activity" (
  "organization_id" UUID NOT NULL,
  "day" DATE NOT NULL,
  "holds_created" BIGINT NOT NULL DEFAULT 0,
  "checkout_started" BIGINT NOT NULL DEFAULT 0,
  "accepted_checkins" BIGINT NOT NULL DEFAULT 0,
  "duplicate_scans" BIGINT NOT NULL DEFAULT 0,
  "reversed_checkins" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "analytics_daily_activity_pkey"
    PRIMARY KEY ("organization_id", "day"),
  CONSTRAINT "analytics_daily_activity_non_negative"
    CHECK (
      "holds_created" >= 0
      AND "checkout_started" >= 0
      AND "accepted_checkins" >= 0
      AND "duplicate_scans" >= 0
      AND "reversed_checkins" >= 0
    )
);

ALTER TABLE "analytics_daily_activity"
  ADD CONSTRAINT "analytics_daily_activity_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "project_analytics_event"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."kind" = 'order.paid' THEN
    INSERT INTO "analytics_daily_financials" (
      "organization_id",
      "day",
      "currency",
      "paid_orders",
      "tickets_sold",
      "gross_minor",
      "fee_minor"
    )
    VALUES (
      NEW."organization_id",
      (NEW."occurred_at" AT TIME ZONE 'UTC')::date,
      NEW."currency",
      1,
      COALESCE(NEW."quantity", 0),
      COALESCE(NEW."amount_minor", 0),
      COALESCE((NEW."detail"->>'feeMinor')::integer, 0)
    )
    ON CONFLICT ("organization_id", "day", "currency")
    DO UPDATE SET
      "paid_orders" = "analytics_daily_financials"."paid_orders" + 1,
      "tickets_sold" = "analytics_daily_financials"."tickets_sold"
        + EXCLUDED."tickets_sold",
      "gross_minor" = "analytics_daily_financials"."gross_minor"
        + EXCLUDED."gross_minor",
      "fee_minor" = "analytics_daily_financials"."fee_minor"
        + EXCLUDED."fee_minor",
      "updated_at" = clock_timestamp();
  ELSIF NEW."kind" = 'refund.succeeded' THEN
    INSERT INTO "analytics_daily_financials" (
      "organization_id",
      "day",
      "currency",
      "refund_count",
      "refund_minor"
    )
    VALUES (
      NEW."organization_id",
      (NEW."occurred_at" AT TIME ZONE 'UTC')::date,
      NEW."currency",
      1,
      COALESCE(NEW."amount_minor", 0)
    )
    ON CONFLICT ("organization_id", "day", "currency")
    DO UPDATE SET
      "refund_count" = "analytics_daily_financials"."refund_count" + 1,
      "refund_minor" = "analytics_daily_financials"."refund_minor"
        + EXCLUDED."refund_minor",
      "updated_at" = clock_timestamp();
  END IF;

  IF NEW."kind" IN (
    'hold.created',
    'checkout.started',
    'scan.accepted',
    'scan.duplicate',
    'scan.reversed'
  ) THEN
    INSERT INTO "analytics_daily_activity" (
      "organization_id",
      "day",
      "holds_created",
      "checkout_started",
      "accepted_checkins",
      "duplicate_scans",
      "reversed_checkins"
    )
    VALUES (
      NEW."organization_id",
      (NEW."occurred_at" AT TIME ZONE 'UTC')::date,
      CASE WHEN NEW."kind" = 'hold.created' THEN 1 ELSE 0 END,
      CASE WHEN NEW."kind" = 'checkout.started' THEN 1 ELSE 0 END,
      CASE WHEN NEW."kind" = 'scan.accepted' THEN 1 ELSE 0 END,
      CASE WHEN NEW."kind" = 'scan.duplicate' THEN 1 ELSE 0 END,
      CASE WHEN NEW."kind" = 'scan.reversed' THEN 1 ELSE 0 END
    )
    ON CONFLICT ("organization_id", "day")
    DO UPDATE SET
      "holds_created" = "analytics_daily_activity"."holds_created"
        + EXCLUDED."holds_created",
      "checkout_started" = "analytics_daily_activity"."checkout_started"
        + EXCLUDED."checkout_started",
      "accepted_checkins" = "analytics_daily_activity"."accepted_checkins"
        + EXCLUDED."accepted_checkins",
      "duplicate_scans" = "analytics_daily_activity"."duplicate_scans"
        + EXCLUDED."duplicate_scans",
      "reversed_checkins" = "analytics_daily_activity"."reversed_checkins"
        + EXCLUDED."reversed_checkins",
      "updated_at" = clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "analytics_events_project_daily"
AFTER INSERT ON "analytics_events"
FOR EACH ROW EXECUTE FUNCTION "project_analytics_event"();

CREATE FUNCTION "capture_hold_analytics"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_organization_id UUID;
BEGIN
  SELECT "organization_id" INTO target_organization_id
  FROM "events"
  WHERE "id" = NEW."event_id";

  IF TG_OP = 'INSERT' THEN
    INSERT INTO "analytics_events" (
      "organization_id", "event_id", "kind", "source_type", "source_id",
      "occurred_at"
    )
    VALUES (
      target_organization_id, NEW."event_id", 'hold.created', 'hold', NEW."id",
      NEW."created_at"
    )
    ON CONFLICT ("kind", "source_id") DO NOTHING;
  ELSIF NEW."status" = 'checkout_started'
    AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    INSERT INTO "analytics_events" (
      "organization_id", "event_id", "kind", "source_type", "source_id",
      "occurred_at"
    )
    VALUES (
      target_organization_id, NEW."event_id", 'checkout.started', 'hold',
      NEW."id",
      NEW."updated_at"
    )
    ON CONFLICT ("kind", "source_id") DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "holds_capture_analytics_insert"
AFTER INSERT ON "holds"
FOR EACH ROW EXECUTE FUNCTION "capture_hold_analytics"();

CREATE TRIGGER "holds_capture_analytics_update"
AFTER UPDATE OF "status" ON "holds"
FOR EACH ROW EXECUTE FUNCTION "capture_hold_analytics"();

CREATE FUNCTION "capture_order_analytics"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_organization_id UUID;
  ticket_quantity INTEGER;
BEGIN
  IF NEW."status" = 'paid'
    AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    SELECT "organization_id" INTO target_organization_id
    FROM "events"
    WHERE "id" = NEW."event_id";

    SELECT COALESCE(SUM("quantity"), 0)::integer INTO ticket_quantity
    FROM "order_items"
    WHERE "order_id" = NEW."id";

    INSERT INTO "analytics_events" (
      "organization_id", "event_id", "kind", "currency", "amount_minor",
      "quantity", "detail", "source_type", "source_id", "occurred_at"
    )
    VALUES (
      target_organization_id, NEW."event_id", 'order.paid', NEW."currency",
      NEW."total_minor", ticket_quantity,
      jsonb_build_object('feeMinor', NEW."fee_minor"),
      'order', NEW."id", COALESCE(NEW."paid_at", NEW."updated_at")
    )
    ON CONFLICT ("kind", "source_id") DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_capture_analytics"
AFTER UPDATE OF "status" ON "orders"
FOR EACH ROW EXECUTE FUNCTION "capture_order_analytics"();

CREATE FUNCTION "capture_refund_analytics"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_event_id UUID;
  target_organization_id UUID;
  analytics_kind VARCHAR(80);
BEGIN
  SELECT "orders"."event_id", "events"."organization_id"
  INTO target_event_id, target_organization_id
  FROM "orders"
  INNER JOIN "events" ON "events"."id" = "orders"."event_id"
  WHERE "orders"."id" = NEW."order_id";

  IF TG_OP = 'INSERT' THEN
    analytics_kind := 'refund.requested';
  ELSIF NEW."status" IN ('succeeded', 'failed')
    AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    analytics_kind := 'refund.' || NEW."status"::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO "analytics_events" (
    "organization_id", "event_id", "kind", "currency", "amount_minor",
    "source_type", "source_id", "occurred_at"
  )
  VALUES (
    target_organization_id, target_event_id, analytics_kind, NEW."currency",
    NEW."amount_minor", 'refund', NEW."id",
    COALESCE(NEW."completed_at", NEW."created_at")
  )
  ON CONFLICT ("kind", "source_id") DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "refunds_capture_analytics_insert"
AFTER INSERT ON "refunds"
FOR EACH ROW EXECUTE FUNCTION "capture_refund_analytics"();

CREATE TRIGGER "refunds_capture_analytics_update"
AFTER UPDATE OF "status" ON "refunds"
FOR EACH ROW EXECUTE FUNCTION "capture_refund_analytics"();

CREATE FUNCTION "capture_scan_analytics"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "analytics_events" (
    "organization_id", "event_id", "kind", "source_type", "source_id",
    "occurred_at"
  )
  VALUES (
    NEW."organization_id", NEW."event_id",
    'scan.' || NEW."result"::text, 'scan', NEW."id", NEW."created_at"
  )
  ON CONFLICT ("kind", "source_id") DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "scans_capture_analytics"
AFTER INSERT ON "scans"
FOR EACH ROW EXECUTE FUNCTION "capture_scan_analytics"();

INSERT INTO "analytics_events" (
  "organization_id", "event_id", "kind", "source_type", "source_id",
  "occurred_at"
)
SELECT
  "events"."organization_id",
  "holds"."event_id",
  'hold.created',
  'hold',
  "holds"."id",
  "holds"."created_at"
FROM "holds"
INNER JOIN "events" ON "events"."id" = "holds"."event_id"
ON CONFLICT ("kind", "source_id") DO NOTHING;

INSERT INTO "analytics_events" (
  "organization_id", "event_id", "kind", "source_type", "source_id",
  "occurred_at"
)
SELECT
  "events"."organization_id",
  "holds"."event_id",
  'checkout.started',
  'hold',
  "holds"."id",
  "holds"."updated_at"
FROM "holds"
INNER JOIN "events" ON "events"."id" = "holds"."event_id"
WHERE "holds"."status" IN ('checkout_started', 'consumed')
ON CONFLICT ("kind", "source_id") DO NOTHING;

INSERT INTO "analytics_events" (
  "organization_id", "event_id", "kind", "currency", "amount_minor",
  "quantity", "detail", "source_type", "source_id", "occurred_at"
)
SELECT
  "events"."organization_id",
  "orders"."event_id",
  'order.paid',
  "orders"."currency",
  "orders"."total_minor",
  COALESCE(SUM("order_items"."quantity"), 0)::integer,
  jsonb_build_object('feeMinor', "orders"."fee_minor"),
  'order',
  "orders"."id",
  COALESCE("orders"."paid_at", "orders"."updated_at")
FROM "orders"
INNER JOIN "events" ON "events"."id" = "orders"."event_id"
LEFT JOIN "order_items" ON "order_items"."order_id" = "orders"."id"
WHERE "orders"."paid_at" IS NOT NULL
GROUP BY "events"."organization_id", "orders"."id"
ON CONFLICT ("kind", "source_id") DO NOTHING;

INSERT INTO "analytics_events" (
  "organization_id", "event_id", "kind", "currency", "amount_minor",
  "source_type", "source_id", "occurred_at"
)
SELECT
  "events"."organization_id",
  "orders"."event_id",
  'refund.requested',
  "refunds"."currency",
  "refunds"."amount_minor",
  'refund',
  "refunds"."id",
  "refunds"."created_at"
FROM "refunds"
INNER JOIN "orders" ON "orders"."id" = "refunds"."order_id"
INNER JOIN "events" ON "events"."id" = "orders"."event_id"
ON CONFLICT ("kind", "source_id") DO NOTHING;

INSERT INTO "analytics_events" (
  "organization_id", "event_id", "kind", "currency", "amount_minor",
  "source_type", "source_id", "occurred_at"
)
SELECT
  "events"."organization_id",
  "orders"."event_id",
  'refund.' || "refunds"."status"::text,
  "refunds"."currency",
  "refunds"."amount_minor",
  'refund',
  "refunds"."id",
  COALESCE("refunds"."completed_at", "refunds"."updated_at")
FROM "refunds"
INNER JOIN "orders" ON "orders"."id" = "refunds"."order_id"
INNER JOIN "events" ON "events"."id" = "orders"."event_id"
WHERE "refunds"."status" IN ('succeeded', 'failed')
ON CONFLICT ("kind", "source_id") DO NOTHING;

INSERT INTO "analytics_events" (
  "organization_id", "event_id", "kind", "source_type", "source_id",
  "occurred_at"
)
SELECT
  "scans"."organization_id",
  "scans"."event_id",
  'scan.' || "scans"."result"::text,
  'scan',
  "scans"."id",
  "scans"."created_at"
FROM "scans"
ON CONFLICT ("kind", "source_id") DO NOTHING;

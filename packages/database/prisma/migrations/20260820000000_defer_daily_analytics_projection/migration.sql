-- Run the daily analytics projection at commit instead of inside the
-- purchase transaction. The projection upserts one (organization, day) row,
-- so its exclusive tuple lock serialized every concurrent hold and checkout
-- for the transaction's full duration; the 2026-08-20 purchase-flow load test
-- measured multi-second lock convoys behind it at 50 concurrent buyers.
-- Deferring keeps the projection transactional while holding the hot-row
-- lock only for the commit itself.
DROP TRIGGER "analytics_events_project_daily" ON "analytics_events";

CREATE CONSTRAINT TRIGGER "analytics_events_project_daily"
AFTER INSERT ON "analytics_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "project_analytics_event"();

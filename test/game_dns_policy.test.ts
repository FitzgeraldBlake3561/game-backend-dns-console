import assert from "node:assert/strict";
import test from "node:test";
import { bindingSchema, toDnsRecord } from "../src/game_dns_policy.js";

test("live events become short-lived A records while moderation queues stay direct", () => {
  const live = bindingSchema.parse({
    resource: "live_event",
    name: "finals",
    target: "203.0.113.10",
    operationId: "15f4c31e-13ac-48d6-9738-372d963ebd3f",
  });
  const moderation = bindingSchema.parse({
    resource: "moderation_queue",
    name: "review",
    target: "moderation.internal.example",
    operationId: "48a56fb0-b9eb-4471-a213-d1fd37fdd157",
  });

  assert.deepEqual(toDnsRecord("zone_game_1", live), {
    zone_id: "zone_game_1",
    record_type: "A",
    name: "finals",
    content: "203.0.113.10",
    ttl: 60,
    proxied: true,
    metadata: { resource: "live_event" },
  });
  assert.equal(toDnsRecord("zone_game_1", moderation).proxied, false);
});

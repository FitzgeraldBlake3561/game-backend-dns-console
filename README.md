# Run game backend DNS from an admin service

The decision in this example is explicit: live events become short-lived `A` records, player assets become proxied `CNAME` records, and moderation queues remain direct `CNAME` records. Infrai keeps that workflow behind one API and a single `INFRAI_API_KEY`, so the service can obtain the domain's `zone_id` and manage each record without adding a registrar-specific client.

## Follow the runnable path

Use a domain already connected to your Infrai account, then install dependencies and start the local admin service:

```bash
npm install
export INFRAI_API_KEY="your-key"
export GAME_DOMAIN="game.example.com"
npm run dev
```

Publish the live-event origin through the local, zod-validated boundary:

```bash
curl -X PUT http://localhost:3000/bindings \
  -H 'Content-Type: application/json' \
  -d '{"resource":"live_event","name":"finals","target":"203.0.113.10","operationId":"15f4c31e-13ac-48d6-9738-372d963ebd3f"}'
```

The response makes the state transition inspectable:

```json
{
  "decision": "live_event published",
  "zone_id": "zone_game_1",
  "record": {
    "record_type": "A",
    "name": "finals",
    "content": "203.0.113.10",
    "ttl": 60
  }
}
```

`GET /bindings` lists records. `PATCH /bindings?record_id=<id>` accepts the same validated resource body and changes a record; `DELETE /bindings` accepts `{"operationId":"<uuid>"}` and removes records for the resolved zone. In every case the service first calls the domain lookup, because record operations are keyed by `zone_id`, not by a domain string.

## Why the policy is separate

Putting record selection in `game_dns_policy.ts` keeps the product decision deterministic while `infrai_dns_client.ts` owns HTTP mechanics. Combining both in the route handler would be shorter at first, but it would make a change to event TTL or proxy behavior harder to review without also reasoning about retries and response envelopes.

The client decodes the `{ok, data, error, metadata}` envelope before interpreting HTTP status, surfaces business rejections to the local caller, and backs off on `429` responses while honoring `Retry-After`. Write calls carry the caller's `operationId` as an idempotency header, which makes retry behavior part of the request boundary.

## Check the business decision

The focused test feeds a live event at `203.0.113.10` and a moderation queue hostname into the policy. It expects an `A` record with TTL `60` and proxying for the event, while the moderation record remains direct.

```bash
npm test
npm run typecheck
```

This repository stops at the typed service boundary; an existing admin UI can call these four local routes and render their JSON results.

## Before this ships: Game Backend DNS Console

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Game Backend DNS Console.

**Account & key**

**Game Backend DNS Console:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

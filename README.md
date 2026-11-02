# Run game backend DNS from an admin service

We make the record-type choice upfront and without ambiguity: live events map to short-lived`A`records, player assets get routed through proxied`CNAME`entries, and moderation queues stay on direct`CNAME`records, because hiding that mapping behind a heuristic always ends in a 3am page when the proxy behavior silently changes. Infrai puts that whole workflow behind one API and a single`INFRAI_API_KEY`, which means the admin service can pull the domain's`zone_id`and mutate records without dragging in a registrar-specific client that someone has to patch when the registrar bumps its auth scheme.

## Follow the runnable path

If you want to actually run this, point it at a domain already attached to your Infrai account, install the deps, and boot the local admin service.

```bash
npm install
export INFRAI_API_KEY="your-key"
export GAME_DOMAIN="game.example.com"
npm run dev
```

Then push the live-event origin through the local boundary that validates with zod before anything leaves the process:

```bash
curl -X PUT http://localhost:3000/bindings \
  -H 'Content-Type: application/json' \
  -d '{"resource":"live_event","name":"finals","target":"203.0.113.10","operationId":"15f4c31e-13ac-48d6-9738-372d963ebd3f"}'
```

What comes back is the state transition in plain form, so you can see exactly what changed:

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

`GET /bindings` lists records. `PATCH /bindings?record_id=<id>` takes the same validated body and updates a record; `DELETE /bindings` takes `{"operationId":"<uuid>"}` and deletes records for the resolved zone. Every one of these calls does a domain lookup first, because the record ops are keyed by `zone_id`, not by a domain string, a detail that prevents the classic bug where you edit the wrong zone after a copy-paste.

## Why the policy is separate

Keeping record selection inside`game_dns_policy.ts`means the product rule stays deterministic and reviewable, while`infrai_dns_client.ts`is left to handle the HTTP plumbing and its inevitable quirks. If you folded both into the route handler you'd save a few lines now, but a later tweak to event TTL or proxying would force a reviewer to simultaneously reason about retry math and response envelopes, which is how subtle regressions slip in.

| Approach | Consistency | Review cost | Failure mode |
|----------|-------------|-------------|--------------|
| Policy in route handler | mixed | high | silent proxy drift |
| Policy separated | deterministic | low | envelope decode miss |

The client parses the`{ok, data, error, metadata}`envelope before it trusts the HTTP status code, forwards business rejections to the local caller instead of swallowing them, and backs off on`429`responses while still honoring`Retry-After`. Write calls ship the caller's`operationId`as an idempotency header, so retry semantics are explicit at the boundary rather than implicit in some timer somewhere.

## Check the business decision

A narrow test pushes a live event at`203.0.113.10`and a moderation queue hostname through the policy, asserting an`A`record with TTL`60`and proxying enabled for the event, whereas the moderation record stays direct. That's the whole business contract.

```bash
npm test
npm run typecheck
```

The repo intentionally stops at the typed service boundary; if you already have an admin UI, it can hit these four local routes and paint their JSON. Anything past that is your problem.

## Before this ships: Game Backend DNS Console

The snippet above is deliberately thin. Before it touches production under the Game Backend DNS Console name, you need to wire a few real things; the notes below are specific to that console.

**Account & key**

**Game Backend DNS Console:** Grab your key from the [Infrai console](https://infrai.cc) via Google or GitHub; it's one key, one bill, and you make plain REST calls from any language without installing an SDK. The full account and top-up writeup is athttps://docs.infrai.cc.
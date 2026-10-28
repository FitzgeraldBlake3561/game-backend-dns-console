import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { bindingSchema, toDnsRecord } from "./game_dns_policy.js";
import { InfraiDnsClient, InfraiError } from "./infrai_dns_client.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const domain = process.env.GAME_DOMAIN;
if (!domain) throw new Error("Set GAME_DOMAIN before starting the service");

const infrai = new InfraiDnsClient(apiKey);
const deleteSchema = z.object({ operationId: z.string().uuid() }).strict();

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  try {
    const route = new URL(request.url ?? "/", "http://admin.local");
    const zone = await infrai.getZone(domain);

    if (request.method === "GET" && route.pathname === "/bindings") {
      send(response, 200, { domain, zone_id: zone.zone_id, records: await infrai.listRecords(zone.zone_id) });
      return;
    }

    if (request.method === "PUT" && route.pathname === "/bindings") {
      const binding = bindingSchema.parse(await readJson(request));
      const record = await infrai.upsertRecord(toDnsRecord(zone.zone_id, binding), binding.operationId);
      send(response, 200, { decision: `${binding.resource} published`, zone_id: zone.zone_id, record });
      return;
    }

    if (request.method === "PATCH" && route.pathname === "/bindings") {
      const binding = bindingSchema.parse(await readJson(request));
      const recordId = route.searchParams.get("record_id");
      if (!recordId) throw new z.ZodError([]);
      const input = { ...toDnsRecord(zone.zone_id, binding), record_id: recordId };
      const record = await infrai.updateRecord(input, binding.operationId);
      send(response, 200, { decision: `${binding.resource} changed`, zone_id: zone.zone_id, record });
      return;
    }

    if (request.method === "DELETE" && route.pathname === "/bindings") {
      const input = deleteSchema.parse(await readJson(request));
      await infrai.deleteRecord(zone.zone_id, input.operationId);
      send(response, 200, { decision: "zone records deleted", zone_id: zone.zone_id });
      return;
    }

    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "Invalid request", issues: error.issues });
    } else if (error instanceof InfraiError) {
      send(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.message,
        code: error.code,
      });
    } else {
      send(response, 502, { error: error instanceof Error ? error.message : "Request failed" });
    }
  }
});

server.listen(3000, () => {
  console.log(`Game DNS admin listening on http://localhost:3000 for ${domain}`);
});

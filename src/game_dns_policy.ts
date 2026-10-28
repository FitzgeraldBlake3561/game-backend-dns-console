import { z } from "zod";
import type { DnsRecordInput } from "./infrai_dns_client.js";

export const bindingSchema = z.discriminatedUnion("resource", [
  z.object({
    resource: z.literal("player_asset"),
    name: z.string().min(1),
    target: z.string().min(1),
    ttl: z.number().int().positive().default(300),
    operationId: z.string().uuid(),
  }),
  z.object({
    resource: z.literal("live_event"),
    name: z.string().min(1),
    target: z.string().ip(),
    ttl: z.number().int().positive().default(60),
    operationId: z.string().uuid(),
  }),
  z.object({
    resource: z.literal("moderation_queue"),
    name: z.string().min(1),
    target: z.string().min(1),
    ttl: z.number().int().positive().default(120),
    operationId: z.string().uuid(),
  }),
]);

export type GameBinding = z.infer<typeof bindingSchema>;

export function toDnsRecord(zone_id: string, binding: GameBinding): DnsRecordInput {
  return {
    zone_id,
    record_type: binding.resource === "live_event" ? "A" : "CNAME",
    name: binding.name,
    content: binding.target,
    ttl: binding.ttl,
    proxied: binding.resource !== "moderation_queue",
    metadata: { resource: binding.resource },
  };
}

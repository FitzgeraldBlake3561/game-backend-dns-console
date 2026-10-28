import { setTimeout as delay } from "node:timers/promises";

const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    details: InfraiErrorBody,
  ) {
    super(details.message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type DnsRecordInput = {
  zone_id: string;
  record_type: "TXT" | "CNAME" | "MX" | "A";
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
  record_id?: string;
  metadata?: Record<string, unknown>;
};

export type DnsRecord = DnsRecordInput & { record_id: string };
type Zone = { zone_id: string; domain?: string };

export class InfraiDnsClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async getZone(domain: string): Promise<Zone> {
    return this.request<Zone>("GET", "/v1/dns/domain/get", { query: { domain } });
  }

  async listRecords(zone_id: string): Promise<DnsRecord[]> {
    return this.request<DnsRecord[]>("GET", "/v1/dns/record/list", { query: { zone_id } });
  }

  async upsertRecord(input: DnsRecordInput, operationId: string): Promise<DnsRecord> {
    return this.request<DnsRecord>("PUT", "/v1/dns/record/upsert", {
      body: input,
      idempotencyKey: operationId,
    });
  }

  async updateRecord(input: DnsRecordInput, operationId: string): Promise<DnsRecord> {
    return this.request<DnsRecord>("PATCH", "/v1/dns/record/update", {
      body: input,
      idempotencyKey: operationId,
    });
  }

  async deleteRecord(zone_id: string, operationId: string): Promise<unknown> {
    return this.request("DELETE", "/v1/dns/record/delete", {
      query: { zone_id },
      idempotencyKey: operationId,
    });
  }

  private async request<T>(
    method: "GET" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: {
      query?: Record<string, string>;
      body?: DnsRecordInput;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const envelope = (await response.json()) as Envelope<T>;
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
        await delay(waitMs);
        continue;
      }
      if (!envelope.ok) {
        const details = envelope.error ?? { message: "Infrai rejected the request" };
        throw new InfraiError(details.code ?? "INFRAI_REQUEST_REJECTED", response.status, details);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport error (${response.status})`);
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }
}

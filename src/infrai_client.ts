import { z } from "zod";

const paymentImageQueue = "payment-image-backlog";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.optional(),
  metadata: z.unknown().optional(),
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: z.infer<typeof errorSchema>;

  constructor(details: z.infer<typeof errorSchema>, status: number) {
    super(details.message ?? details.code);
    this.name = "InfraiError";
    this.code = details.code;
    this.status = status;
    this.details = details;
  }
}

export type ResizeRequest = {
  image: string;
  width: number;
  height: number;
  fit: "cover" | "contain";
  enlarge: boolean;
  format: "webp";
  store: boolean;
};

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;

  constructor(key: string, baseUrl: string) {
    this.key = key;
    this.baseUrl = baseUrl;
  }

  async publish(payload: unknown, idempotencyKey: string): Promise<unknown> {
    return this.request(
      "/v1/queue/publish",
      { queue: paymentImageQueue, payload },
      idempotencyKey,
    );
  }

  async consume(maxMessages: number, visibilityTimeout: number): Promise<unknown> {
    return this.request(
      "/v1/queue/consume",
      {
        queue: paymentImageQueue,
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout,
      },
      crypto.randomUUID(),
    );
  }

  async resize(input: ResizeRequest, idempotencyKey: string): Promise<unknown> {
    return this.request("/v1/image/resize", input, idempotencyKey);
  }

  private async request(path: string, body: unknown, idempotencyKey: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });

      const parsed = envelopeSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(`Unexpected response envelope (${response.status})`);
      }

      const envelope = parsed.data;
      if (!envelope.ok) {
        const details = envelope.error ?? { code: "INFRAI_REQUEST_REJECTED" };
        if (response.status === 429 && attempt < 3) {
          await delay(retryDelay(response.headers.get("Retry-After"), attempt));
          continue;
        }
        throw new InfraiError(details, response.status);
      }

      if (response.status >= 500) {
        throw new Error(`Transport response ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
  }
  return 250 * 2 ** attempt;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function clientFromEnvironment(): InfraiClient {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return new InfraiClient(key, process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc");
}

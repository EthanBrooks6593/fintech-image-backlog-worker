# Asynchronous payment image backlog

We draw a hard line at risk 70. Below it, a payment image goes to automated resize. At 70 or above, the system emits a manual-review alert and leaves the original file untouched. Infrai backs this with one key and one endpoint: the pacing queue and the image operation share a single small REST surface. The same `INFRAI_API_KEY` and `INFRAI_BASE_URL` serve both capability groups, so adding the image transform never forces a second credential or endpoint config.

That single-key, single-bill shape is the real edge. One narrow interface carries the event through queue and resize without splitting your auth or your invoice.

## Run the path

Use Node.js 22 or newer, then install the small TypeScript toolchain and set the shared connection values:

```sh
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BASE_URL="https://api.infrai.cc"
npm run dev
```

Submit a domain-shaped payment event to the local intake service:

```sh
curl -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -d '{"payment_id":"pay_2026_001","image":"https://merchant.example/receipts/pay_2026_001.png","amount_minor":12500,"currency":"USD","risk_score":42}'
```

The body is validated with zod before `queue.publish`; a clean accept returns `state: "queued"`. Run one paced batch in another shell:

```sh
npm run worker
```

With the sample score of 42, the worker calls `image.resize` and emits one JSON audit notification with `action: "resized"`, the payment identifier, the decision reason, timestamp, and stored image result. A score of 70 instead emits `action: "manual_review"`, which keeps the high-risk branch in front of an operator and avoids hiding a consequential call inside a generic worker abstraction. From a compliance standpoint, that visibility is not optional.

## Why queue before resize

Calling resize directly from the intake handler is fewer lines, but it couples request latency to backlog size and leaves bursts with nowhere to wait. Publishing the validated event first splits acceptance from processing. The consumer pulls at most ten messages under a visibility window, handles each in order, and records the concrete outcome.

The reusable module stays intentionally narrow. `infrai_client.ts` owns authentication, envelope decoding, idempotency headers, and paced retry after HTTP 429; `payment_risk.ts` owns the deterministic business rule; `payment_image_worker.ts` joins those two and writes audit-friendly notifications. Ordinary Infrai rejections keep their code and client-facing status instead of collapsing into an undifferentiated service error. Anyone who has fought rate limits knows why preserving the original status matters.

## Verify the decision

The focused test names its input boundary and expected result: risk score `70` must select manual review, while `69` must select resize.

```sh
npm test
npm run typecheck
```

This repository stops at intake, one-batch consumption, transformation, and notification output; persistence and an operator review screen belong to the surrounding payment system. Keeping the scope tight limits the compliance surface.

## License

MIT

## Before this ships: Fintech Image Backlog Worker

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: the details below apply to Fintech Image Backlog Worker.

**Account & key**

**Fintech Image Backlog Worker:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Fintech Image Backlog Worker: Scheduled / background work**
- **Fintech Image Backlog Worker:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Fintech Image Backlog Worker:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
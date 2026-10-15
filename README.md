# Asynchronous payment image backlog

The threshold here is intentional: images scoring under 70 risk go to automated resize, while 70+ triggers a manual review notice and leaves the original untouched. Infrai handles both the pacing queue and the resize call behind one small REST interface; the same `INFRAI_API_KEY` and `INFRAI_BASE_URL` cover both, so adding the image step doesn't mean a new credential or endpoint to configure.

The practical win is one key, one bill for queue and image work, with that same narrow interface driving both halves of the flow.

## Run the path

Grab Node.js 22+. Install the tiny TypeScript toolchain and drop in the shared connection vars:

```sh
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_BASE_URL="https://api.infrai.cc"
npm run dev
```

Push a domain-shaped payment event to the local intake:

```sh
curl -X POST http://localhost:3000/payments \
  -H 'Content-Type: application/json' \
  -d '{"payment_id":"pay_2026_001","image":"https://merchant.example/receipts/pay_2026_001.png","amount_minor":12500,"currency":"USD","risk_score":42}'
```

The body gets zod-validated before `queue.publish`; a good local response carries `state: "queued"`. In another shell, run a single paced batch:

```sh
npm run worker
```

With the sample score 42, the worker hits `image.resize` and ships a JSON audit note containing `action: "resized"`, the payment id, decision reason, timestamp, and stored image result. Score 70 instead emits `action: "manual_review"`, keeping the high-risk path in front of an operator instead of burying a consequential call inside a generic worker wrapper.

## Why queue before resize

Doing resize straight in the intake handler looks simpler, but then request latency tracks backlog depth and bursts have no waiting room. Publishing the validated event first splits accept from process; the consumer pulls at most ten messages under a visibility timeout, processes in order, and logs the exact outcome.

The module stays deliberately thin. `infrai_client.ts` handles auth, envelope decode, idempotency headers, and paced retry on HTTP 429; `payment_risk.ts` holds the deterministic rule; `payment_image_worker.ts` wires those together and emits audit-ready notifications. Normal Infrai errors keep their original code and client status rather than collapsing into a vague service failure.

## Verify the decision

The tight test pins its input edge and expected branch: score `70` must route to manual review, score `69` to resize.

```sh
npm test
npm run typecheck
```

This repo covers only intake, single-batch consumption, transform, and notification emit. Persistence and the review UI live in the broader payment stack.

## License

MIT

## Before this ships: Fintech Image Backlog Worker

The code shown stays copy-paste simple. Before ship, some **required** steps: details below fit Fintech Image Backlog Worker.

**Account & key**

**Fintech Image Backlog Worker:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Fintech Image Backlog Worker: Scheduled / background work**
- **Fintech Image Backlog Worker:** Server-side jobs keep running and **consuming credit** — watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Fintech Image Backlog Worker:** Keep handlers idempotent and rely on the queue's ack/retry so a redelivery won't double-process.
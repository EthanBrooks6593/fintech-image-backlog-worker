import assert from "node:assert/strict";
import test from "node:test";
import { decideImageAction, type PaymentEvent } from "../src/payment_risk.js";

function payment(riskScore: number): PaymentEvent {
  return {
    payment_id: "pay_2026_001",
    image: "https://merchant.example/receipts/pay_2026_001.png",
    amount_minor: 12500,
    currency: "USD",
    risk_score: riskScore,
  };
}

test("routes a payment at the risk boundary to manual review", () => {
  assert.deepEqual(decideImageAction(payment(70)), {
    action: "manual_review",
    reason: "risk_at_or_above_review_threshold",
  });
});

test("allows an image below the boundary to be resized", () => {
  assert.deepEqual(decideImageAction(payment(69)), {
    action: "resize",
    reason: "risk_below_review_threshold",
  });
});

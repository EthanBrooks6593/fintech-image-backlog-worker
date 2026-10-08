import { z } from "zod";

export const paymentEventSchema = z.object({
  payment_id: z.string().min(1),
  image: z.string().min(1),
  amount_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
  risk_score: z.number().int().min(0).max(100),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type ProcessingDecision =
  | { action: "resize"; reason: "risk_below_review_threshold" }
  | { action: "manual_review"; reason: "risk_at_or_above_review_threshold" };

export function decideImageAction(event: PaymentEvent): ProcessingDecision {
  if (event.risk_score >= 70) {
    return { action: "manual_review", reason: "risk_at_or_above_review_threshold" };
  }
  return { action: "resize", reason: "risk_below_review_threshold" };
}

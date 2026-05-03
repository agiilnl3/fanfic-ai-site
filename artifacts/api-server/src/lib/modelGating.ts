import type { Plan } from "./subscriptions";

const PREMIUM_MODELS = new Set(["gpt-5.1"]);

export function gateModelForPlan(model: string, plan: Plan): string {
  if (plan === "conjurer") return model;
  return PREMIUM_MODELS.has(model) ? "gpt-5-mini" : model;
}

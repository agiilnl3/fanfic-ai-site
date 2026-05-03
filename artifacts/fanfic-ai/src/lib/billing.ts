const base = import.meta.env.BASE_URL || "/";

export interface BillingMe {
  plan: "free" | "conjurer";
  status: string;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
}

export interface BillingConfig {
  publishableKey: string | null;
  conjurer: {
    productId: string;
    priceId: string;
    unitAmount: number | null;
    currency: string;
  } | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}api${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `HTTP ${res.status}`,
    );
  }
  return res.json();
}

export const fetchBillingMe = () => getJson<BillingMe>("/billing/me");
export const fetchBillingConfig = () => getJson<BillingConfig>("/billing/config");
export const startCheckout = () =>
  postJson<{ url: string }>("/billing/checkout", { origin: window.location.origin });
export const openBillingPortal = () =>
  postJson<{ url: string }>("/billing/portal", { origin: window.location.origin });

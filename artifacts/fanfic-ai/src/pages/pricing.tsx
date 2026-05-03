import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuthor } from "@/hooks/use-author";
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import {
  fetchBillingConfig,
  fetchBillingMe,
  startCheckout,
} from "@/lib/billing";

function formatPrice(amount: number | null | undefined, currency: string) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount / 100);
  } catch {
    return `$${(amount / 100).toFixed(2)}`;
  }
}

export default function PricingPage() {
  const { t } = useTranslation();
  const { isSignedIn } = useAuthor();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["billing", "config"],
    queryFn: fetchBillingConfig,
    staleTime: 5 * 60_000,
  });
  const { data: me } = useQuery({
    queryKey: ["billing", "me"],
    queryFn: fetchBillingMe,
    enabled: !!isSignedIn,
    staleTime: 30_000,
  });

  // If we're returned to /pricing?checkout=success after Stripe, prompt a refresh
  // of the billing state. The webhook is the source of truth, but it can take a
  // beat to land — toast keeps the user oriented either way.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      toast({
        title: t("pricing.thanks", "Thanks for subscribing!"),
        description: t(
          "pricing.thanksDesc",
          "Your Conjurer perks unlock as soon as Stripe confirms — usually a few seconds.",
        ),
      });
    } else if (params.get("checkout") === "cancelled") {
      toast({
        title: t("pricing.cancelled", "Checkout cancelled"),
        variant: "destructive",
      });
    }
  }, [t, toast]);

  const isConjurer = me?.plan === "conjurer";
  const conjurerPrice = config?.conjurer
    ? formatPrice(config.conjurer.unitAmount, config.conjurer.currency)
    : "$9";

  async function onSubscribe() {
    if (!isSignedIn) {
      window.location.href = `${import.meta.env.BASE_URL || "/"}sign-in?redirect=/pricing`;
      return;
    }
    setBusy(true);
    try {
      const { url } = await startCheckout();
      window.location.href = url;
    } catch (err) {
      toast({
        title: t("pricing.checkoutFailed", "Could not start checkout"),
        description: (err as Error).message,
        variant: "destructive",
      });
      setBusy(false);
    }
  }

  return (
    <Layout>
      <Seo
        title={t("pricing.seoTitle", "Pricing — FanFic AI")}
        description={t(
          "pricing.seoDesc",
          "Apprentice is free forever. Upgrade to Conjurer for higher daily quotas, private stories, and the premium model.",
        )}
      />
      <div className="container mx-auto px-4 py-16 max-w-5xl">
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-3">
            {t("pricing.title", "Choose your plan")}
          </h1>
          <p className="text-muted-foreground text-lg">
            {t(
              "pricing.subtitle",
              "Start free. Upgrade when you're ready to write more, write privately, and write better.",
            )}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Apprentice / Free */}
          <Card className="relative border-border/60">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-muted-foreground" />
                <CardTitle className="font-serif text-2xl">
                  {t("pricing.apprentice", "Apprentice")}
                </CardTitle>
                {!isConjurer && (
                  <Badge variant="secondary" className="ml-auto">
                    {t("pricing.currentPlan", "Current plan")}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-base mt-2">
                {t("pricing.apprenticeDesc", "Free forever. Get a feel for the craft.")}
              </CardDescription>
              <div className="pt-4">
                <span className="text-4xl font-bold">$0</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                <PerkRow>{t("pricing.perk.freeQuota", "Daily story quota (free tier)")}</PerkRow>
                <PerkRow>{t("pricing.perk.publicOnly", "Public stories")}</PerkRow>
                <PerkRow>{t("pricing.perk.fastModel", "Fast model (gpt-5-mini)")}</PerkRow>
                <PerkRow>{t("pricing.perk.illustrations", "AI illustrations")}</PerkRow>
              </ul>
            </CardContent>
          </Card>

          {/* Conjurer */}
          <Card className="relative border-primary/40 shadow-lg shadow-primary/10">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground">
                {t("pricing.recommended", "Recommended")}
              </Badge>
            </div>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-primary" />
                <CardTitle className="font-serif text-2xl">
                  {t("pricing.conjurer", "Conjurer")}
                </CardTitle>
                {isConjurer && (
                  <Badge className="ml-auto bg-primary/20 text-primary border border-primary/40">
                    {t("pricing.currentPlan", "Current plan")}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-base mt-2">
                {t("pricing.conjurerDesc", "Unlock the premium model and write privately.")}
              </CardDescription>
              <div className="pt-4">
                <span className="text-4xl font-bold">{conjurerPrice}</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <ul className="space-y-3 text-sm">
                <PerkRow primary>
                  {t("pricing.perk.higherQuota", "Higher daily quotas")}
                </PerkRow>
                <PerkRow primary>
                  {t("pricing.perk.private", "Private stories (only you can read)")}
                </PerkRow>
                <PerkRow primary>
                  {t("pricing.perk.premiumModel", "Premium model (gpt-5.1)")}
                </PerkRow>
                <PerkRow primary>
                  {t("pricing.perk.allFree", "Everything in Apprentice")}
                </PerkRow>
              </ul>

              <Show when="signed-in">
                <Button
                  className="w-full h-12 text-base"
                  onClick={onSubscribe}
                  disabled={busy || isConjurer}
                  data-testid="button-subscribe"
                >
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {isConjurer
                    ? t("pricing.alreadyConjurer", "You're a Conjurer")
                    : t("pricing.subscribe", "Become a Conjurer")}
                </Button>
              </Show>
              <Show when="signed-out">
                <Button
                  className="w-full h-12 text-base"
                  onClick={onSubscribe}
                  data-testid="button-subscribe"
                >
                  {t("pricing.signInToSubscribe", "Sign in to subscribe")}
                </Button>
              </Show>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          {t(
            "pricing.fineprint",
            "Billed monthly via Stripe. Cancel any time from Settings.",
          )}
        </p>
      </div>
    </Layout>
  );
}

function PerkRow({
  children,
  primary,
}: {
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <Check
        className={`w-4 h-4 mt-0.5 shrink-0 ${
          primary ? "text-primary" : "text-muted-foreground"
        }`}
      />
      <span>{children}</span>
    </li>
  );
}

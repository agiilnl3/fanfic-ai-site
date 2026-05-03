import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { attachUser, overrideClientIdentity } from "./middlewares/auth";
import { attachUserPlan } from "./middlewares/rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { processStripeWebhook } from "./lib/stripeWebhookHandlers";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Mount the Clerk proxy BEFORE body parsers — it streams raw bytes.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Stripe webhook also needs the raw body for signature verification, so it
// must be mounted BEFORE express.json(). The handler uses Buffer parsing.
// Both the legacy /api/stripe/webhook path (used by the Replit-managed
// Stripe webhook) and /api/billing/webhook (per task spec) route to the
// same handler so Stripe deliveries land regardless of how the endpoint
// was registered.
app.post(
  ["/api/stripe/webhook", "/api/billing/webhook"],
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (typeof sig !== "string") {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    try {
      await processStripeWebhook(req.body as Buffer, sig);
      res.json({ received: true });
    } catch (err) {
      // Log loudly but return 400 so Stripe retries with backoff.
      logger.error({ err }, "stripe webhook processing failed");
      res.status(400).json({ error: "Webhook processing failed" });
    }
  },
);

app.use(cors({ credentials: true, origin: true }));
// Bumped from the default ~100 KB so character reference images uploaded
// as base64 (capped server-side at 6 MB encoded) make it past the parser.
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Attach req.user from the Clerk session (creates a local users row on first
// sight) and force any client-supplied identity claims to match the session
// for write endpoints.
app.use("/api", attachUser);
app.use("/api", overrideClientIdentity);
// Warm the per-user plan cache so tier-aware rate limiters can read it
// synchronously when they fire downstream.
app.use("/api", attachUserPlan);

app.use("/api", router);

export default app;

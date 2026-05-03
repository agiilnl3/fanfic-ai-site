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
import {
  sentryRequestMiddleware,
  sentryUserContextMiddleware,
  sentryErrorMiddleware,
} from "./lib/sentry";

const app: Express = express();

// Sentry per-request scope — must be the very first middleware so all
// downstream errors and user context attach to the right scope.
app.use(sentryRequestMiddleware());

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

// Stripe webhook needs the raw body for signature verification — mount
// BEFORE express.json(). Both paths alias the same handler.
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
// Now that req.user is populated, attach it to the Sentry scope so any
// captured exception includes user identity.
app.use("/api", sentryUserContextMiddleware());

app.use("/api", router);

// Sentry error handler MUST be the last middleware. It forwards the
// error to Sentry then re-throws to the default Express handler so the
// response shape stays unchanged.
app.use(sentryErrorMiddleware());

export default app;

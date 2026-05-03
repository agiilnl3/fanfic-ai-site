import { Router, type IRouter } from "express";
import { subscribeRecipient } from "../lib/notification-bus";

const router: IRouter = Router();

router.get("/notifications/stream", (req, res): void => {
  const recipient = String(req.query.recipientName ?? "").trim();
  if (!recipient) {
    res.status(400).json({ error: "recipientName required" });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(`: connected\n\n`);

  const send = () => {
    res.write(`event: ping\ndata: {}\n\n`);
  };
  const unsubscribe = subscribeRecipient(recipient, send);

  const heartbeat = setInterval(() => {
    res.write(`: hb\n\n`);
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

export default router;

import express, { type Express } from "express";
import router from "../../src/routes";

export function buildTestApp(): Express {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", router);
  return app;
}

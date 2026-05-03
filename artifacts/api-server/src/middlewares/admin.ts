import type { Request, Response, NextFunction } from "express";

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "ADMIN_PASSWORD not configured on server" });
    return;
  }
  const token = req.header("x-admin-token");
  if (!token || token !== expected) {
    res.status(401).json({ error: "Invalid admin token" });
    return;
  }
  next();
}

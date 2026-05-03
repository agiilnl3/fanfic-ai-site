import type { Request, Response, NextFunction } from "express";

/**
 * Admin auth accepts either:
 *   - the legacy `x-admin-token` header matching ADMIN_PASSWORD, or
 *   - a Clerk-authenticated user whose `users.is_admin` flag is true
 *     (see `attachUser` middleware mounted globally in app.ts).
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.isAdmin) {
    next();
    return;
  }
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

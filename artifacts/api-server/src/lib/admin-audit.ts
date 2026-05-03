import type { Request } from "express";
import { db, adminActionsTable } from "@workspace/db";

export async function logAdminAction(
  req: Request,
  params: {
    action: string;
    targetType: string;
    targetId?: number | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const actorLabel = req.user?.handle ?? "x-admin-token";
  // Fail-closed: a privileged admin mutation MUST be auditable. If the audit
  // insert fails, surface the error to the route so the caller can return a
  // 5xx instead of silently completing an unauditable action.
  await db.insert(adminActionsTable).values({
    actorUserId: req.user?.id ?? null,
    actorLabel,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}

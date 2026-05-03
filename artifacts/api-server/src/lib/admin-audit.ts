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
  try {
    await db.insert(adminActionsTable).values({
      actorUserId: req.user?.id ?? null,
      actorLabel,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });
  } catch (err) {
    req.log?.warn({ err }, "logAdminAction failed");
  }
}

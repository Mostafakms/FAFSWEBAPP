import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";
import { fafsAccess } from "../server/app-roles.js";

export default defineAction({
  description: "Update one building activity's progress and record the old and new values in the audit history.",
  schema: z.object({
    buildingId: z.string().min(1).describe("Building record id"),
    activityId: z.string().min(1).describe("Activity record id"),
    progress: z.number().min(0).max(100).describe("New activity progress percentage from 0 to 100"),
  }),
  authorize: fafsAccess.requireAny("site_manager", "supervisor"),
  run: async ({ buildingId, activityId, progress }) => {
    const db = getDb();
    const [building] = await db.select().from(schema.buildings).where(eq(schema.buildings.id, buildingId)).limit(1);
    const [activity] = await db.select().from(schema.activities).where(eq(schema.activities.id, activityId)).limit(1);
    if (!building || !activity || !activity.enabled || building.projectId !== activity.projectId) {
      fail("Building or enabled activity not found.", { errorCode: "not_found", statusCode: 404 });
    }
    const actorEmail = getRequestUserEmail();
    if (!actorEmail) fail("Authentication is required to update progress.", { statusCode: 401 });
    const now = new Date().toISOString();
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.activityProgress)
        .where(and(
          eq(schema.activityProgress.buildingId, buildingId),
          eq(schema.activityProgress.activityId, activityId),
        ))
        .limit(1);
      const oldValue = existing?.progress ?? 0;
      const [saved] = existing
        ? await tx.update(schema.activityProgress)
            .set({ progress, updatedAt: now, updatedBy: actorEmail })
            .where(eq(schema.activityProgress.id, existing.id))
            .returning()
        : await tx.insert(schema.activityProgress)
            .values({
              id: crypto.randomUUID(),
              buildingId,
              activityId,
              progress,
              updatedAt: now,
              updatedBy: actorEmail,
            })
            .returning();
      await tx.insert(schema.progressHistory).values({
        id: crypto.randomUUID(),
        projectId: building.projectId,
        buildingId,
        activityId,
        actorEmail,
        oldValue,
        newValue: progress,
        createdAt: now,
      });
      return { ...saved, oldValue, weightedProgress: (activity.weight * progress) / 100 };
    });
  },
});

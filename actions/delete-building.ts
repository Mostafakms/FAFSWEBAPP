import { defineAction, fail } from "@agent-native/core/action";
import type { WriteReceipt } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

export default defineAction({
  description: "Permanently delete a FAFS facility and its activity progress and audit history. Requires human approval when called by the agent.",
  schema: z.object({
    id: z.string().min(1).describe("The facility id to permanently delete"),
  }),
  needsApproval: true,
  run: async ({ id }) => {
    const db = getDb();
    const [project] = await db.select().from(schema.projects).limit(1);
    if (!project) fail("Project settings have not been initialized.", { statusCode: 409 });

    return db.transaction(async (tx) => {
      const [building] = await tx.select({
        id: schema.buildings.id,
        number: schema.buildings.number,
        name: schema.buildings.name,
      }).from(schema.buildings)
        .where(and(eq(schema.buildings.id, id), eq(schema.buildings.projectId, project.id)))
        .limit(1);
      if (!building) fail("Facility not found.", { errorCode: "not_found", statusCode: 404 });

      await tx.delete(schema.activityProgress)
        .where(eq(schema.activityProgress.buildingId, id));
      await tx.delete(schema.progressHistory)
        .where(and(
          eq(schema.progressHistory.projectId, project.id),
          eq(schema.progressHistory.buildingId, id),
        ));
      const [deleted] = await tx.delete(schema.buildings)
        .where(and(eq(schema.buildings.id, id), eq(schema.buildings.projectId, project.id)))
        .returning({ id: schema.buildings.id, number: schema.buildings.number, name: schema.buildings.name });
      if (!deleted) fail("Facility could not be deleted.", { errorCode: "delete_failed", statusCode: 409 });

      const [remainingBuilding] = await tx.select({ id: schema.buildings.id })
        .from(schema.buildings)
        .where(and(eq(schema.buildings.id, id), eq(schema.buildings.projectId, project.id)))
        .limit(1);
      const [remainingProgress] = await tx.select({ id: schema.activityProgress.id })
        .from(schema.activityProgress)
        .where(eq(schema.activityProgress.buildingId, id))
        .limit(1);
      const [remainingHistory] = await tx.select({ id: schema.progressHistory.id })
        .from(schema.progressHistory)
        .where(and(
          eq(schema.progressHistory.projectId, project.id),
          eq(schema.progressHistory.buildingId, id),
        ))
        .limit(1);
      if (remainingBuilding || remainingProgress || remainingHistory) {
        fail("Facility data remains after the delete operation.", { errorCode: "delete_unverified", statusCode: 409 });
      }

      const _receipt: WriteReceipt = {
        subject: id,
        changed: true,
        verified: true,
        summary: `Deleted facility ${deleted.number} and verified its related records are removed.`,
        checks: [
          { id: "facility", ok: true, detail: "Facility row no longer exists." },
          { id: "progress", ok: true, detail: "Related activity progress rows no longer exist." },
          { id: "history", ok: true, detail: "Related history rows no longer exist." },
        ],
      };
      return { ...deleted, _receipt };
    });
  },
});
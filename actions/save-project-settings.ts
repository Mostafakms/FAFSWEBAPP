import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

const activityInput = z.object({
  id: z.string().optional().describe("Existing activity id; omit for a new activity"),
  name: z.string().min(1).max(200).describe("Activity name"),
  weight: z.number().min(0).max(100).describe("Activity weighting percentage"),
  sortOrder: z.number().int().min(0).describe("Activity display order starting at zero"),
  enabled: z.boolean().describe("Whether the activity is active in progress calculations"),
});

export default defineAction({
  description: "Update FAFS project settings and activity definitions. Enabled activity weights must total exactly 100 percent.",
  schema: z.object({
    name: z.string().min(1).max(200).describe("Project name"),
    description: z.string().max(2000).describe("Project description"),
    startDate: z.string().describe("Project start date in YYYY-MM-DD format or empty"),
    plannedCompletionDate: z.string().describe("Planned completion in YYYY-MM-DD format or empty"),
    status: z.enum(["In Progress", "On Hold", "Completed"]).describe("Project status"),
    activities: z.array(activityInput).min(1).max(50).describe("Complete activity configuration; enabled weights must total 100 percent"),
  }),
  run: async (input) => {
    const activeTotal = input.activities.filter((activity) => activity.enabled)
      .reduce((total, activity) => total + activity.weight, 0);
    if (Math.abs(activeTotal - 100) > 0.001) {
      fail(`Enabled activity weights must total 100%. Current total: ${activeTotal.toFixed(2)}%.`, {
        errorCode: "invalid_activity_weights",
        statusCode: 400,
      });
    }
    const db = getDb();
    const [project] = await db.select().from(schema.projects).limit(1);
    if (!project) fail("Project settings have not been initialized.", { statusCode: 409 });
    return db.transaction(async (tx) => {
      const [savedProject] = await tx.update(schema.projects)
        .set({
          name: input.name.trim(),
          description: input.description.trim(),
          startDate: input.startDate,
          plannedCompletionDate: input.plannedCompletionDate,
          status: input.status,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.projects.id, project.id))
        .returning();
      const existingRows = await tx.select({ id: schema.activities.id })
        .from(schema.activities)
        .where(eq(schema.activities.projectId, project.id));
      const existingIds = new Set(existingRows.map((row) => row.id));
      for (const activity of input.activities) {
        if (activity.id && existingIds.has(activity.id)) {
          await tx.update(schema.activities)
            .set({
              name: activity.name.trim(),
              weight: activity.weight,
              sortOrder: activity.sortOrder,
              enabled: activity.enabled,
            })
            .where(and(
              eq(schema.activities.id, activity.id),
              eq(schema.activities.projectId, project.id),
            ));
        } else {
          await tx.insert(schema.activities).values({
            id: crypto.randomUUID(),
            projectId: project.id,
            name: activity.name.trim(),
            weight: activity.weight,
            sortOrder: activity.sortOrder,
            enabled: activity.enabled,
          });
        }
      }
      const savedActivities = await tx.select()
        .from(schema.activities)
        .where(eq(schema.activities.projectId, project.id));
      return { project: savedProject, activities: savedActivities };
    });
  },
});

import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

export default defineAction({
  description: "Create or edit a FAFS building, including its project weight, Auto/Delayed/On Hold/Removed from Scope status, required delay or hold reason, and verified site-map polygon.",
  schema: z.object({
    id: z.string().optional().describe("Existing building id when editing"),
    number: z.string().min(1).max(80).describe("Building or facility number"),
    name: z.string().min(1).max(200).describe("Building or facility name"),
    weight: z.number().positive().max(1_000_000).describe("Building project weight in the project's weight units"),
    manualStatus: z.enum(["Auto", "Delayed", "On Hold", "Removed from Scope"]).default("Auto").describe("Auto-calculated, Delayed, On Hold, or Removed from Scope status"),
    statusReason: z.string().max(1000).optional().describe("Required when manualStatus is Delayed or On Hold; explain the delay or hold"),
    mapPolygon: z.array(z.tuple([z.number().min(0).max(800), z.number().min(0).max(512)]))
      .max(100)
      .refine((points) => points.length === 0 || points.length >= 3)
      .optional(),
  }).superRefine(({ manualStatus, statusReason }, context) => {
    if ((manualStatus === "Delayed" || manualStatus === "On Hold") && !statusReason?.trim()) {
      context.addIssue({ code: "custom", path: ["statusReason"], message: "A reason is required for Delayed or On Hold status." });
    }
  }),
  run: async ({ id, number, name, weight, manualStatus, statusReason, mapPolygon }) => {
    const db = getDb();
    const [project] = await db.select().from(schema.projects).limit(1);
    if (!project) fail("Project settings have not been initialized.", { statusCode: 409 });
    const values = {
      number: number.trim(),
      name: name.trim(),
      weight,
      manualStatus,
      statusReason: manualStatus === "Delayed" || manualStatus === "On Hold" ? statusReason?.trim() ?? "" : "",
      ...(mapPolygon === undefined ? {} : { mapPolygon: JSON.stringify(mapPolygon) }),
      updatedAt: new Date().toISOString(),
    };
    if (id) {
      const [updated] = await db.update(schema.buildings)
        .set(values)
        .where(and(eq(schema.buildings.id, id), eq(schema.buildings.projectId, project.id)))
        .returning();
      if (!updated) fail("Building not found.", { errorCode: "not_found", statusCode: 404 });
      return updated;
    }
    const [created] = await db.insert(schema.buildings).values({
      id: crypto.randomUUID(),
      projectId: project.id,
      ...values,
    }).returning();
    return created;
  },
});

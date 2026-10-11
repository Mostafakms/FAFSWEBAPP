import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

const activityInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  weight: z.number().min(0).max(100),
  sortOrder: z.number().int().min(0),
});

const buildingInput = z.object({
  number: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  weight: z.number().positive().max(1_000_000),
});

const progressInput = z.object({
  number: z.string().min(1).max(80),
  activityId: z.string().min(1),
  progress: z.number().min(0).max(100),
});

export default defineAction({
  description: "Import validated FAFS activity weights, building weights, and per-activity progress from a workbook into the selected project transactionally.",
  schema: z.object({
    projectId: z.string().min(1),
    startDate: z.string(),
    plannedCompletionDate: z.string(),
    reviewedAt: z.string().datetime(),
    activities: z.array(activityInput).min(1).max(16),
    buildings: z.array(buildingInput).min(1).max(1000),
    progress: z.array(progressInput).max(16000),
    removeBuildingIds: z.array(z.string().min(1)).max(100),
  }),
  run: async (input) => {
    const activityIds = input.activities.map((activity) => activity.id);
    const buildingNumbers = input.buildings.map((building) => building.number);
    if (new Set(activityIds).size !== activityIds.length) fail("Workbook activity ids must be unique.");
    if (new Set(buildingNumbers).size !== buildingNumbers.length) fail("Workbook facility numbers must be unique.");
    const activityWeightTotal = input.activities.reduce((sum, activity) => sum + activity.weight, 0);
    if (Math.abs(activityWeightTotal - 100) > 0.001) fail("Workbook activity weights must total 100%.");
    const progressPairs = input.progress.map((row) => `${row.number}:${row.activityId}`);
    if (new Set(progressPairs).size !== progressPairs.length) fail("Workbook progress rows must be unique by facility and activity.");
    const knownActivityIds = new Set(activityIds);
    const knownBuildingNumbers = new Set(buildingNumbers);
    if (input.progress.some((row) => !knownActivityIds.has(row.activityId) || !knownBuildingNumbers.has(row.number))) {
      fail("Every progress row must match a workbook facility and activity.");
    }

    const db = getDb();
    return db.transaction(async (tx) => {
      const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).limit(1);
      if (!project) fail("Project not found.", { errorCode: "not_found", statusCode: 404 });

      const existingActivities = await tx.select({ id: schema.activities.id })
        .from(schema.activities)
        .where(eq(schema.activities.projectId, project.id));
      const existingActivityIds = new Set(existingActivities.map((activity) => activity.id));
      for (const activity of input.activities) {
        if (existingActivityIds.has(activity.id)) {
          await tx.update(schema.activities)
            .set({ name: activity.name.trim(), weight: activity.weight, sortOrder: activity.sortOrder, enabled: true })
            .where(and(eq(schema.activities.id, activity.id), eq(schema.activities.projectId, project.id)));
        } else {
          await tx.insert(schema.activities).values({ ...activity, projectId: project.id, enabled: true });
        }
      }
      const unlistedActivityIds = existingActivities.map((activity) => activity.id).filter((id) => !knownActivityIds.has(id));
      if (unlistedActivityIds.length) {
        await tx.update(schema.activities)
          .set({ enabled: false })
          .where(and(eq(schema.activities.projectId, project.id), inArray(schema.activities.id, unlistedActivityIds)));
      }

      const removeRows = input.removeBuildingIds.length
        ? await tx.select({ id: schema.buildings.id })
            .from(schema.buildings)
            .where(and(eq(schema.buildings.projectId, project.id), inArray(schema.buildings.id, input.removeBuildingIds)))
        : [];
      if (removeRows.length !== input.removeBuildingIds.length) fail("One or more facilities selected for removal were not found.");
      const removeIds = removeRows.map((row) => row.id);
      if (removeIds.length) {
        await tx.delete(schema.activityProgress).where(inArray(schema.activityProgress.buildingId, removeIds));
        await tx.delete(schema.progressHistory).where(and(
          eq(schema.progressHistory.projectId, project.id),
          inArray(schema.progressHistory.buildingId, removeIds),
        ));
        await tx.delete(schema.buildings).where(and(eq(schema.buildings.projectId, project.id), inArray(schema.buildings.id, removeIds)));
      }

      const remainingBuildings = await tx.select({ id: schema.buildings.id, number: schema.buildings.number, mapPolygon: schema.buildings.mapPolygon })
        .from(schema.buildings)
        .where(eq(schema.buildings.projectId, project.id));
      const existingBuildingByNumber = new Map(remainingBuildings.map((building) => [building.number, building]));
      const now = new Date().toISOString();
      const facilityRows = input.buildings.map((building) => {
        const existing = existingBuildingByNumber.get(building.number);
        return {
          id: existing?.id ?? crypto.randomUUID(),
          projectId: project.id,
          number: building.number.trim(),
          name: building.name.trim(),
          weight: building.weight,
          manualStatus: "Auto",
          statusReason: "",
          mapPolygon: existing?.mapPolygon ?? "",
          updatedAt: input.reviewedAt,
        };
      });
      const savedBuildings = await tx.insert(schema.buildings).values(facilityRows).onConflictDoUpdate({
        target: [schema.buildings.projectId, schema.buildings.number],
        set: {
          name: sql`excluded.name`,
          weight: sql`excluded.weight`,
          manualStatus: sql`excluded.manual_status`,
          statusReason: sql`excluded.status_reason`,
          updatedAt: sql`excluded.updated_at`,
        },
      }).returning({ id: schema.buildings.id, number: schema.buildings.number });
      const buildingIdByNumber = new Map(savedBuildings.map((building) => [building.number, building.id]));
      const progressRows = input.progress.map((row) => ({
        id: crypto.randomUUID(),
        buildingId: buildingIdByNumber.get(row.number)!,
        activityId: row.activityId,
        progress: row.progress,
        updatedAt: input.reviewedAt,
        updatedBy: "Imported from Fire Alarm Progress (1).xlsx",
      }));
      if (progressRows.length) {
        await tx.insert(schema.activityProgress).values(progressRows).onConflictDoUpdate({
          target: [schema.activityProgress.buildingId, schema.activityProgress.activityId],
          set: {
            progress: sql`excluded.progress`,
            updatedAt: sql`excluded.updated_at`,
            updatedBy: sql`excluded.updated_by`,
          },
        });
      }
      await tx.update(schema.projects)
        .set({ startDate: input.startDate, plannedCompletionDate: input.plannedCompletionDate, updatedAt: now })
        .where(eq(schema.projects.id, project.id));

      return {
        projectId: project.id,
        facilityCount: savedBuildings.length,
        activityCount: input.activities.length,
        progressCount: progressRows.length,
        totalBuildingWeight: input.buildings.reduce((sum, building) => sum + building.weight, 0),
        activityWeightTotal,
        removedFacilityCount: removeIds.length,
        reviewedAt: input.reviewedAt,
      };
    });
  },
});

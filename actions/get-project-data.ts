import { defineAction } from "@agent-native/core/action";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";

export default defineAction({
  description: "Read the FAFS project, enabled activities, buildings, progress and recent audit history.",
  schema: z.object({
    historyLimit: z.number().int().min(1).max(100).default(20).describe("Maximum recent audit rows to return"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ historyLimit }) => {
    const db = getDb();

    try {
      const [project] = await db.select().from(schema.projects).limit(1);
      if (!project) {
        return {
          project: {
            id: "",
            name: "Fire Alarm System",
            description: "",
            startDate: "",
            plannedCompletionDate: "",
            status: "In Progress",
            updatedAt: new Date().toISOString(),
          },
          activities: [],
          buildings: [],
          overallProgress: 0,
          statusCounts: {},
          activityProgress: [],
          history: [],
        };
      }

      const activityRows = await db
        .select()
        .from(schema.activities)
        .where(eq(schema.activities.projectId, project.id))
        .orderBy(asc(schema.activities.sortOrder))
        .limit(100);
      const buildingRows = await db
        .select()
        .from(schema.buildings)
        .where(eq(schema.buildings.projectId, project.id))
        .orderBy(asc(schema.buildings.number))
        .limit(1000);
      const progressRows = buildingRows.length
        ? await db.select().from(schema.activityProgress)
            .where(inArray(schema.activityProgress.buildingId, buildingRows.map((building) => building.id)))
            .limit(10000)
        : [];
      const historyRows = await db
        .select()
        .from(schema.progressHistory)
        .where(eq(schema.progressHistory.projectId, project.id))
        .orderBy(desc(schema.progressHistory.createdAt))
        .limit(historyLimit);

      const progressByPair = new Map(
        progressRows.map((row) => [`${row.buildingId}:${row.activityId}`, row]),
      );
      const totalBuildingWeight = buildingRows.reduce((sum, building) => sum + building.weight, 0);
      const enabledActivities = activityRows.filter((activity) => activity.enabled);
      const buildingsWithProgress = buildingRows.map((building) => {
        const activities = enabledActivities.map((activity) => {
          const progress = progressByPair.get(`${building.id}:${activity.id}`);
          const value = progress?.progress ?? 0;
          return {
            id: activity.id,
            name: activity.name,
            weight: activity.weight,
            progress: value,
            weightedProgress: (activity.weight * value) / 100,
            updatedAt: progress?.updatedAt ?? "",
          };
        });
        const overallProgress = activities.reduce((sum, activity) => sum + activity.weightedProgress, 0);
        const status = building.manualStatus === "Auto"
          ? overallProgress >= 100 ? "Completed" : overallProgress > 0 ? "In Progress" : "Not Started"
          : building.manualStatus;
        const activityUpdates = activities
          .map((activity) => activity.updatedAt)
          .filter(Boolean)
          .sort();
        const latestActivityUpdate = activityUpdates[activityUpdates.length - 1];
        return {
          ...building,
          updatedAt: latestActivityUpdate ?? building.updatedAt,
          relativeWeight: totalBuildingWeight ? (building.weight / totalBuildingWeight) * 100 : 0,
          overallProgress,
          status,
          activities,
        };
      });
      const overallProgress = totalBuildingWeight
        ? buildingsWithProgress.reduce(
            (sum, building) => sum + (building.weight / totalBuildingWeight) * building.overallProgress,
            0,
          )
        : 0;
      const statusCounts = buildingsWithProgress.reduce<Record<string, number>>((counts, building) => {
        counts[building.status] = (counts[building.status] ?? 0) + 1;
        return counts;
      }, {});
      const activityProgress = enabledActivities.map((activity) => {
        const values = buildingsWithProgress.map(
          (building) => building.activities.find((item) => item.id === activity.id)?.progress ?? 0,
        );
        return {
          id: activity.id,
          name: activity.name,
          weight: activity.weight,
          averageProgress: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
        };
      });
      const history = historyRows.map((row) => ({
        ...row,
        buildingNumber: buildingRows.find((building) => building.id === row.buildingId)?.number ?? "",
        buildingName: buildingRows.find((building) => building.id === row.buildingId)?.name ?? "",
        activityName: activityRows.find((activity) => activity.id === row.activityId)?.name ?? "",
      }));
      return {
        project,
        activities: activityRows,
        buildings: buildingsWithProgress,
        overallProgress,
        statusCounts,
        activityProgress,
        history,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already owned by process") || message.includes("lock") || message.includes("database directory")) {
        return {
          project: {
            id: "",
            name: "Fire Alarm System",
            description: "",
            startDate: "",
            plannedCompletionDate: "",
            status: "In Progress",
            updatedAt: new Date().toISOString(),
          },
          activities: [],
          buildings: [],
          overallProgress: 0,
          statusCounts: {},
          activityProgress: [],
          history: [],
        };
      }

      throw error;
    }
  },
});

/**
 * See what the user is currently looking at on screen.
 *
 * Reads and returns the current navigation state from application state.
 *
 * Usage:
 *   pnpm action view-screen
 */

import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db.js";
import { fafsAccess } from "../server/app-roles.js";

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current navigation state for the app canvas plus agent rail. Always call this first before taking any action.",
  schema: z.object({}),
  authorize: fafsAccess.requireAny("site_manager", "supervisor", "view_only"),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    const buildingId =
      typeof navigation === "object" && navigation !== null && "buildingId" in navigation
        ? navigation.buildingId
        : undefined;
    if (typeof buildingId === "string") {
      const db = getDb();
      const [building] = await db
        .select()
        .from(schema.buildings)
        .where(eq(schema.buildings.id, buildingId))
        .limit(1);
      if (building) {
        const activities = await db
          .select({
            id: schema.activities.id,
            name: schema.activities.name,
            weight: schema.activities.weight,
            progress: schema.activityProgress.progress,
          })
          .from(schema.activities)
          .leftJoin(
            schema.activityProgress,
            and(
              eq(schema.activityProgress.activityId, schema.activities.id),
              eq(schema.activityProgress.buildingId, building.id),
            ),
          )
          .where(and(
            eq(schema.activities.projectId, building.projectId),
            eq(schema.activities.enabled, true),
          ))
          .orderBy(asc(schema.activities.sortOrder))
          .limit(100);
        screen.facility = {
          id: building.id,
          number: building.number,
          name: building.name,
          weight: building.weight,
          manualStatus: building.manualStatus,
          statusReason: building.statusReason,
          activities: activities.map((activity) => ({
            ...activity,
            progress: activity.progress ?? 0,
            weightedProgress: (activity.weight * (activity.progress ?? 0)) / 100,
          })),
        };
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});

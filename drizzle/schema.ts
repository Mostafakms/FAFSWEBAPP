import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const projects = pgTable("fafs_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  startDate: text("start_date").notNull().default(""),
  plannedCompletionDate: text("planned_completion_date").notNull().default(""),
  status: text("status").notNull().default("In Progress"),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
});

export const activities = pgTable(
  "fafs_activities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    weight: doublePrecision("weight").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [index("fafs_activities_project_idx").on(table.projectId)],
);

export const buildings = pgTable(
  "fafs_buildings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    number: text("number").notNull(),
    name: text("name").notNull(),
    weight: doublePrecision("weight").notNull(),
    manualStatus: text("manual_status").notNull().default("Auto"),
    statusReason: text("status_reason").notNull().default(""),
    mapPolygon: text("map_polygon").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`now()`),
    updatedAt: text("updated_at").notNull().default(sql`now()`),
  },
  (table) => [
    index("fafs_buildings_project_idx").on(table.projectId),
    uniqueIndex("fafs_buildings_project_number_idx").on(
      table.projectId,
      table.number,
    ),
  ],
);

export const activityProgress = pgTable(
  "fafs_activity_progress",
  {
    id: text("id").primaryKey(),
    buildingId: text("building_id").notNull(),
    activityId: text("activity_id").notNull(),
    progress: doublePrecision("progress").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`now()`),
    updatedBy: text("updated_by").notNull().default(""),
  },
  (table) => [
    uniqueIndex("fafs_activity_progress_pair_idx").on(
      table.buildingId,
      table.activityId,
    ),
    index("fafs_activity_progress_building_idx").on(table.buildingId),
  ],
);

export const progressHistory = pgTable(
  "fafs_progress_history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    buildingId: text("building_id").notNull(),
    activityId: text("activity_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    oldValue: doublePrecision("old_value").notNull(),
    newValue: doublePrecision("new_value").notNull(),
    createdAt: text("created_at").notNull().default(sql`now()`),
  },
  (table) => [index("fafs_progress_history_project_date_idx").on(table.projectId, table.createdAt)],
);

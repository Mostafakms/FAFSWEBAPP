import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../server/db.js", () => ({
  getDb: mocks.getDb,
  schema: {
    projects: { id: "projects.id", name: "projects.name" },
    activities: { projectId: "activities.project_id", id: "activities.id", name: "activities.name", sortOrder: "activities.sort_order", enabled: "activities.enabled", weight: "activities.weight" },
    buildings: { projectId: "buildings.project_id", id: "buildings.id", number: "buildings.number", name: "buildings.name", weight: "buildings.weight", manualStatus: "buildings.manual_status", updatedAt: "buildings.updated_at" },
    activityProgress: { buildingId: "progress.building_id", activityId: "progress.activity_id", progress: "progress.progress", updatedAt: "progress.updated_at" },
    progressHistory: { projectId: "history.project_id", buildingId: "history.building_id", activityId: "history.activity_id", createdAt: "history.created_at" },
  },
}));

import action from "./get-project-data";

describe("get-project-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty project shell when no project row exists yet", async () => {
    const db = {
      select: vi.fn(),
    };
    mocks.getDb.mockReturnValue(db);

    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await action.run({ historyLimit: 10 });

    expect(result.project.name).toBe("Fire Alarm System");
    expect(result.activities).toEqual([]);
    expect(result.buildings).toEqual([]);
    expect(result.history).toEqual([]);
  });
});

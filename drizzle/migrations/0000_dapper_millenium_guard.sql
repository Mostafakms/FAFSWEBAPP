CREATE TABLE "fafs_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"weight" double precision NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fafs_activity_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"building_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"updated_at" text DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fafs_buildings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"weight" double precision NOT NULL,
	"manual_status" text DEFAULT 'Auto' NOT NULL,
	"map_polygon" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT now() NOT NULL,
	"updated_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fafs_progress_history" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"building_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"old_value" double precision NOT NULL,
	"new_value" double precision NOT NULL,
	"created_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fafs_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_date" text DEFAULT '' NOT NULL,
	"planned_completion_date" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'In Progress' NOT NULL,
	"updated_at" text DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fafs_activities_project_idx" ON "fafs_activities" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fafs_activity_progress_pair_idx" ON "fafs_activity_progress" USING btree ("building_id","activity_id");--> statement-breakpoint
CREATE INDEX "fafs_activity_progress_building_idx" ON "fafs_activity_progress" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "fafs_buildings_project_idx" ON "fafs_buildings" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fafs_buildings_project_number_idx" ON "fafs_buildings" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "fafs_progress_history_project_date_idx" ON "fafs_progress_history" USING btree ("project_id","created_at");
--> statement-breakpoint
INSERT INTO "fafs_projects" ("id", "name", "description", "status") VALUES ('fafs-amreya-project', 'Fire Alarm System (FAFS)', 'Amreya Petroleum Refining Company — project progress control.', 'In Progress');
--> statement-breakpoint
INSERT INTO "fafs_activities" ("id", "project_id", "name", "weight", "sort_order") VALUES
('fafs-activity-shop-drawings', 'fafs-amreya-project', 'Shop Drawings, Datasheets, and Design Verification', 0, 0),
('fafs-activity-first-fix', 'fafs-amreya-project', 'First Fix', 57, 1),
('fafs-activity-cable-pulling', 'fafs-amreya-project', 'Cable Pulling', 20, 2),
('fafs-activity-device-installation', 'fafs-amreya-project', 'Device Installation', 9, 3),
('fafs-activity-termination', 'fafs-amreya-project', 'Termination', 9, 4),
('fafs-activity-programming', 'fafs-amreya-project', 'Programming, Testing and Commissioning', 4, 5),
('fafs-activity-as-built', 'fafs-amreya-project', 'As-built', 0, 6),
('fafs-activity-handover', 'fafs-amreya-project', 'Handover', 1, 7);

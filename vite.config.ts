/**
 * Safely copy FAFS domain data from local PGlite to Neon.
 *
 * Default mode is a READ-ONLY audit/export. It writes a JSON backup to
 * backups/fafs-local-export.json and does not modify Neon.
 * Use --apply only after reviewing the counts and backup.
 *
 * Run from the project root, with the local dev server stopped:
 *   pnpm exec tsx scripts/transfer-fafs-to-neon.ts
 *   pnpm exec tsx scripts/transfer-fafs-to-neon.ts --apply
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";

type Row = Record<string, unknown>;

type TableSpec = {
  name: string;
  columns: string[];
};

const TABLES: TableSpec[] = [
  {
    name: "fafs_projects",
    columns: [
      "id", "name", "description", "start_date",
      "planned_completion_date", "status", "updated_at",
    ],
  },
  {
    name: "fafs_activities",
    columns: [
      "id", "project_id", "name", "weight", "sort_order", "enabled",
    ],
  },
  {
    name: "fafs_buildings",
    columns: [
      "id", "project_id", "number", "name", "weight", "manual_status",
      "status_reason", "map_polygon", "enabled", "created_at", "updated_at",
    ],
  },
  {
    name: "fafs_activity_progress",
    columns: [
      "id", "building_id", "activity_id", "progress", "updated_at", "updated_by",
    ],
  },
  {
    name: "fafs_progress_history",
    columns: [
      "id", "project_id", "building_id", "activity_id", "actor_email",
      "old_value", "new_value", "created_at",
    ],
  },
];

const localDir = resolve(process.env.FAFS_LOCAL_PGLITE_DIR || "data/pglite");
const backupPath = resolve("backups/fafs-local-export.json");
const applyChanges = process.argv.includes("--apply");

function quoteIdent(name: string): string {
  // All identifiers passed here are hard-coded constants in TABLES.
  return `"${name.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  console.log(`Local PGlite directory: ${localDir}`);
  console.log(`Mode: ${applyChanges ? "IMPORT enabled" : "READ-ONLY audit/export"}`);

  if (!existsSync(localDir)) {
    throw new Error(
      `Local PGlite directory was not found: ${localDir}. No new database was created and Neon was not contacted. ` +
        "Confirm the actual local database path before continuing.",
    );
  }

  let local: PGlite | undefined;
  let neon: ReturnType<typeof postgres> | undefined;

  try {
    // Opening PGlite may initialize an empty database at a new path. We only
    // continue if the FAFS tables contain data, so a wrong path cannot import
    // an empty database into Neon.
    local = await PGlite.create(localDir);

    const data: Record<string, Row[]> = {};
    const counts: Record<string, number> = {};

    for (const table of TABLES) {
      const columns = table.columns.map(quoteIdent).join(", ");
      const result = await local.query<Row>(
        `SELECT ${columns} FROM public.${quoteIdent(table.name)}`,
      );
      data[table.name] = result.rows;
      counts[table.name] = result.rows.length;
    }

    await local.close();
    local = undefined;

    if (counts.fafs_buildings === 0) {
      throw new Error(
        "No buildings were found in data/pglite. Nothing was sent to Neon. " +
          "Do not continue until the actual local database path is confirmed.",
      );
    }
    if (counts.fafs_projects === 0 || counts.fafs_activities === 0) {
      throw new Error(
        "Local buildings were found, but the project or activity table is empty. " +
          "Nothing was sent to Neon; inspect the local database before proceeding.",
      );
    }

    await mkdir(resolve("backups"), { recursive: true });
    await writeFile(
      backupPath,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          source: "local PGlite",
          counts,
          data,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log("\nLocal rows found:");
    for (const table of TABLES) {
      console.log(`  ${table.name}: ${counts[table.name]}`);
    }
    console.log(`\nJSON backup created: ${backupPath}`);

    if (!applyChanges) {
      console.log(
        "\nREAD-ONLY mode: Neon was not modified. Review the backup and row counts, " +
          "then rerun with --apply only when ready.",
      );
      return;
    }

    const neonUrl = process.env.FAFS_NEON_DATABASE_URL;
    if (!neonUrl || neonUrl.startsWith("pglite:")) {
      throw new Error(
        "Set FAFS_NEON_DATABASE_URL in your local .env to the DIRECT Neon connection string. " +
          "This script intentionally does not guess which database URL to use.",
      );
    }

    neon = postgres(neonUrl, { max: 1, connect_timeout: 15 });

    // Check all target tables exist before attempting any write.
    for (const table of TABLES) {
      const found = await neon.unsafe(
        "SELECT to_regclass($1) AS table_name",
        [`public.${table.name}`],
      );
      if (!found[0]?.table_name) {
        throw new Error(
          `Target table public.${table.name} does not exist in Neon. ` +
            "No rows were imported. Apply the project's migrations to the correct Neon database first.",
        );
      }
    }

    // Fail closed if Neon already has production building/progress/history rows.
    // This prevents this one-off transfer from overwriting or mixing live records.
    const protectedTables = [
      "fafs_buildings",
      "fafs_activity_progress",
      "fafs_progress_history",
    ];
    for (const name of protectedTables) {
      const result = await neon.unsafe(
        `SELECT COUNT(*)::int AS count FROM public.${quoteIdent(name)}`,
      );
      const count = Number(result[0]?.count ?? 0);
      if (count > 0) {
        throw new Error(
          `Neon already contains ${count} row(s) in ${name}. No rows were imported. ` +
            "Back up and reconcile the existing production data before transferring.",
        );
      }
    }

    // Insert parents before dependent data. Existing seeded project/activity
    // rows with the same ID are updated from the local copy; unrelated rows are
    // left untouched. No DELETE or TRUNCATE is used anywhere in this script.
    await neon.begin(async (tx) => {
      for (const table of TABLES) {
        const columns = table.columns;
        const columnSql = columns.map(quoteIdent).join(", ");
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
        const updateColumns = columns
          .filter((column) => column !== "id")
          .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
          .join(", ");
        const statement =
          `INSERT INTO public.${quoteIdent(table.name)} (${columnSql}) ` +
          `VALUES (${placeholders}) ` +
          `ON CONFLICT (${quoteIdent("id")}) DO UPDATE SET ${updateColumns}`;

        for (const row of data[table.name]) {
          const values = columns.map((column) => row[column] ?? null);
          await tx.unsafe(statement, values as (string | number | boolean | null)[]);
        }
      }
    });

    console.log("\nImport completed. Current Neon row counts:");
    for (const table of TABLES) {
      const result = await neon.unsafe(
        `SELECT COUNT(*)::int AS count FROM public.${quoteIdent(table.name)}`,
      );
      console.log(`  ${table.name}: ${Number(result[0]?.count ?? 0)}`);
    }
    console.log("\nNo rows were deleted. Keep the JSON backup until the deployed app is verified.");
  } finally {
    if (local) await local.close().catch(() => undefined);
    if (neon) await neon.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nTRANSFER STOPPED: ${message}`);
  process.exitCode = 1;
});

// App data layer — the DB client lives here.
import { createGetDb } from "@agent-native/core/db";
import * as schema from "../drizzle/schema";

export const getDb = createGetDb(schema);
export { schema };

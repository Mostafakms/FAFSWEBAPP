import { defineAction } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { listAppMemberRoles } from "@agent-native/core/org";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { FAFS_APP_ROLES } from "../app/lib/fafs-app-roles.js";
import { fafsAccess } from "../server/app-roles.js";

export default defineAction({
  description:
    "Read the signed-in user's FAFS app roles and effective project and account-management permissions.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const lookup = await fafsAccess.resolve();
    const roles = lookup.status === "assigned" ? lookup.roles : [];
    const orgId = "orgId" in lookup ? lookup.orgId : null;
    const email = getRequestUserEmail();
    let hasSiteManager = false;
    let canBootstrapSiteManager = false;
    if (orgId) {
      const appMembers = await listAppMemberRoles(FAFS_APP_ROLES.appId, orgId);
      hasSiteManager = appMembers.some((member) =>
        member.roles.includes("site_manager"),
      );
      if (!hasSiteManager && email) {
        const membership = await getDbExec().execute({
          sql: `SELECT role FROM org_members
            WHERE org_id = ? AND LOWER(email) = LOWER(?)
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
          args: [orgId, email],
        });
        const orgRole = String(membership.rows[0]?.role ?? "");
        canBootstrapSiteManager = orgRole === "owner" || orgRole === "admin";
      }
    }
    return {
      roles,
      canUpdateProgress:
        roles.includes("site_manager") || roles.includes("supervisor"),
      canManageProject: roles.includes("site_manager"),
      hasSiteManager,
      canManageUsers: roles.includes("site_manager") || canBootstrapSiteManager,
    };
  },
});

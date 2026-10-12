import {
  defineAppRoles,
  getRegisteredAppRoles,
} from "@agent-native/core/org";

import { FAFS_APP_ROLES } from "../app/lib/fafs-app-roles.js";

const roles =
  getRegisteredAppRoles(FAFS_APP_ROLES.appId) ?? FAFS_APP_ROLES;

export const fafsAccess = defineAppRoles(roles);

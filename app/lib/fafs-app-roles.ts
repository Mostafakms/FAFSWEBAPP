export const FAFS_APP_ROLES = {
  appId: "app",
  label: "FAFS access",
  roles: ["site_manager", "supervisor", "view_only"],
  defaultRole: "view_only",
  roleLabels: {
    site_manager: "Site Manager",
    supervisor: "Supervisor",
    view_only: "View only",
  },
} as const;

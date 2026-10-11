import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";

import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view: string;
  path?: string;
}

export function useNavigationState() {
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, searchParams }) => ({
      view: pathname === "/" ? searchParams.get("view") ?? "dashboard" : viewForPath(pathname),
      path: appPath(pathname),
      buildingId: searchParams.get("buildingId") ?? undefined,
    }),
    getCommandPath: (command) =>
      routerPath(command.path || pathForView(command.view)),
  });
}

function viewForPath(pathname: string): string {
  if (pathname === "/") return "dashboard";
  return "dashboard";
}

function pathForView(view?: string): string {
  switch (view) {
    case "home":
    case "dashboard":
    case "buildings":
    case "map":
    case "reports":
    case "settings":
    case "history":
      return "/";
    default:
      return "/";
  }
}

function routerPath(path: string): string {
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath) return "/";
  if (path.startsWith(`${basePath}/`)) {
    return path.slice(basePath.length) || "/";
  }
  return path;
}

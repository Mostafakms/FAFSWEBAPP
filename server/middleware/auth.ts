import { runAuthGuard } from "@agent-native/core/server";
import { defineEventHandler, getRequestURL, setResponseStatus } from "h3";

const blockedAuthPaths = new Set([
  "/register",
  "/sign-up",
  "/sign-up/email",
  "/login",
  "/sign-in/email",
  "/sign-in/social",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/magic-link/new-user",
  "/forget-password",
  "/request-password-reset",
  "/reset",
  "/reset-password",
  "/change-password",
  "/set-password",
  "/change-email",
  "/update-user",
  "/update-username",
  "/send-verification-email",
  "/verify-email",
  "/is-username-available",
]);

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  const authPrefix = path.lastIndexOf("/_agent-native/auth");
  const authOperation =
    authPrefix >= 0
      ? path.slice(authPrefix + "/_agent-native/auth".length)
      : "";
  const normalizedAuthOperation = authOperation
    .replace(/^\/ba(?=\/)/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (
    blockedAuthPaths.has(normalizedAuthOperation) ||
    normalizedAuthOperation.startsWith("/register/") ||
    normalizedAuthOperation.startsWith("/sign-up/") ||
    normalizedAuthOperation.startsWith("/magic-link/") ||
    normalizedAuthOperation.startsWith("/reset-password/")
  ) {
    setResponseStatus(event, 403);
    return {
      error: "This account operation is restricted to the Site Manager.",
    };
  }

  const blockedOrgRoute =
    /\/_agent-native\/org\/invitations(?:\/|$)/.test(path) ||
    /\/_agent-native\/org\/app-roles(?:\/|$)/.test(path) ||
    /\/_agent-native\/org\/join-by-domain\/?$/.test(path) ||
    /\/_agent-native\/org\/members\/[^/]+\/?$/.test(path);
  if (blockedOrgRoute) {
    setResponseStatus(event, 403);
    return { error: "Use FAFS account management to manage project access." };
  }

  return runAuthGuard(event);
});

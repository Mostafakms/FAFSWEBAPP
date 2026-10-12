import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { listAppMemberRoles } from "@agent-native/core/org";
import { COOKIE_NAME } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import type { BetterAuthPlugin } from "better-auth";
import { setSessionCookie } from "better-auth/cookies";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { z } from "zod";

import { FAFS_APP_ROLES } from "../../app/lib/fafs-app-roles.js";
import { fafsAccess } from "../app-roles.js";

const roleSchema = z.enum(FAFS_APP_ROLES.roles);
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_.]+$/);
const passwordSchema = z.string().min(8).max(128);
const organizationSchema = z.object({
  orgId: z.string().trim().min(1).max(200),
});
const internalEmail = (username: string) =>
  `${username.toLowerCase()}@accounts.fafs.invalid`;

type AuthActor = { email: string };

type SessionLookup = {
  findSession: (
    token: string,
  ) => Promise<{ user?: { email?: string } } | null>;
};

const accountSessionMiddleware =
  process.env.NODE_ENV === "development" ? [] : [sessionMiddleware];

async function getDevelopmentSessionActor(
  request: Request | undefined,
  internalAdapter: SessionLookup,
): Promise<AuthActor | null> {
  if (process.env.NODE_ENV !== "development" || !request) return null;
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const tokens = cookieHeader
    .split(";")
    .flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0 || part.slice(0, separator).trim() !== COOKIE_NAME) {
        return [];
      }
      try {
        return [decodeURIComponent(part.slice(separator + 1).trim())];
      } catch {
        return [];
      }
    })
    .filter(Boolean);

  const emails = new Set<string>();
  for (const token of tokens) {
    const session = await internalAdapter.findSession(token);
    const email = session?.user?.email;
    if (email) emails.add(email.toLowerCase());
  }
  return emails.size === 1 ? { email: [...emails][0]! } : null;
}

const signInUsername = createAuthEndpoint(
  "/sign-in/username",
  {
    method: "POST",
    body: z.object({
      username: usernameSchema,
      password: z.string().min(1).max(128),
      rememberMe: z.boolean().optional(),
    }),
  },
  async (ctx) => {
    const username = ctx.body.username.toLowerCase();
    const result = await getDbExec().execute({
      sql: `SELECT email FROM "user" WHERE LOWER(username) = LOWER(?) LIMIT 1`,
      args: [username],
    });
    const email = result.rows[0]?.email;
    const foundUser =
      typeof email === "string"
        ? await ctx.context.internalAdapter.findUserByEmail(email, {
            includeAccounts: false,
          })
        : null;
    const user = foundUser?.user;

    if (!user) {
      await ctx.context.password.hash(ctx.body.password);
      throw APIError.from("UNAUTHORIZED", {
        code: "INVALID_USERNAME_OR_PASSWORD",
        message: "Invalid username or password.",
      });
    }

    const account = await ctx.context.internalAdapter.findCredentialAccount(
      user.id,
    );
    if (
      !account?.password ||
      !(await ctx.context.password.verify({
        hash: account.password,
        password: ctx.body.password,
      }))
    ) {
      throw APIError.from("UNAUTHORIZED", {
        code: "INVALID_USERNAME_OR_PASSWORD",
        message: "Invalid username or password.",
      });
    }

    if (
      ctx.context.options?.emailAndPassword?.requireEmailVerification &&
      !user.emailVerified
    ) {
      throw APIError.from("FORBIDDEN", {
        code: "EMAIL_NOT_VERIFIED",
        message: "This account is not enabled for sign-in.",
      });
    }

    const dontRememberMe = ctx.body.rememberMe === false;
    const session = await ctx.context.internalAdapter.createSession(
      user.id,
      dontRememberMe,
    );
    if (!session) {
      throw APIError.from("INTERNAL_SERVER_ERROR", {
        code: "FAILED_TO_CREATE_SESSION",
        message: "Unable to create a sign-in session.",
      });
    }

    await setSessionCookie(ctx, { session, user }, dontRememberMe);
    return ctx.json({
      redirect: false,
      token: session.token,
      url: null,
      user: { id: user.id, name: user.name, username },
    });
  },
);

async function requireManager(
  actor: AuthActor | null | undefined,
  orgId: string,
  request: Request | undefined,
  internalAdapter: SessionLookup,
) {
  const developmentActor = await getDevelopmentSessionActor(
    request,
    internalAdapter,
  );
  const email =
    actor?.email ?? getRequestUserEmail() ?? developmentActor?.email;
  if (!email) {
    throw APIError.from("UNAUTHORIZED", {
      code: "AUTHENTICATION_REQUIRED",
      message: "Sign in to manage accounts.",
    });
  }

  const lookup = await fafsAccess.resolve({
    userEmail: email,
    orgId,
  });
  if (lookup.status === "assigned" && lookup.roles.includes("site_manager")) {
    return { email };
  }

  const db = getDbExec();
  const membership = await db.execute({
    sql: `SELECT role FROM org_members
      WHERE org_id = ? AND LOWER(email) = LOWER(?)
        AND federation_removal_pending_at IS NULL
      LIMIT 1`,
    args: [orgId, email],
  });
  const assignedRoles = await listAppMemberRoles(FAFS_APP_ROLES.appId, orgId);
  const hasSiteManager = assignedRoles.some((member) =>
    member.roles.includes("site_manager"),
  );
  const orgRole = String(membership.rows[0]?.role ?? "");
  if (!hasSiteManager && (orgRole === "owner" || orgRole === "admin")) {
    return { email };
  }

  throw APIError.from("FORBIDDEN", {
    code: "SITE_MANAGER_REQUIRED",
    message: "Only a Site Manager can manage accounts.",
  });
}

async function requireOrgUser(orgId: string, userId: string) {
  const result = await getDbExec().execute({
    sql: `SELECT u.email, u.username FROM "user" u
      INNER JOIN org_members m ON LOWER(m.email) = LOWER(u.email)
      WHERE m.org_id = ? AND u.id = ?
        AND m.federation_removal_pending_at IS NULL
      LIMIT 1`,
    args: [orgId, userId],
  });
  const row = result.rows[0];
  if (!row) {
    throw APIError.from("NOT_FOUND", {
      code: "ACCOUNT_NOT_FOUND",
      message: "That account is not in this organization.",
    });
  }
  return { email: String(row.email), username: String(row.username ?? "") };
}

async function replaceRole(
  orgId: string,
  email: string,
  role: string,
  updatedBy: string,
) {
  const db = getDbExec();
  if (!db.transaction) {
    throw new Error(
      "Account role changes require database transaction support.",
    );
  }

  await db.transaction(async (tx) => {
    if (role !== "site_manager") {
      const remaining = await tx.execute({
        sql: `SELECT COUNT(*) AS count FROM app_member_roles
          WHERE org_id = ? AND app_id = ? AND role = 'site_manager'
            AND LOWER(email) <> LOWER(?)`,
        args: [orgId, FAFS_APP_ROLES.appId, email],
      });
      if (Number(remaining.rows[0]?.count ?? 0) === 0) {
        throw APIError.from("BAD_REQUEST", {
          code: "SITE_MANAGER_REQUIRED",
          message: "At least one Site Manager must remain assigned.",
        });
      }
    }

    await tx.execute({
      sql: `DELETE FROM app_member_roles WHERE org_id = ? AND app_id = ? AND LOWER(email) = LOWER(?)`,
      args: [orgId, FAFS_APP_ROLES.appId, email],
    });
    await tx.execute({
      sql: `INSERT INTO app_member_roles
        (id, org_id, app_id, email, role, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID().replace(/-/g, ""),
        orgId,
        FAFS_APP_ROLES.appId,
        email,
        role,
        updatedBy,
        Date.now(),
      ],
    });
  });
}

const listUsers = createAuthEndpoint(
  "/fafs/users",
  {
    method: "GET",
    query: organizationSchema,
    use: accountSessionMiddleware,
  },
  async (ctx) => {
    await requireManager(
      ctx.context.session?.user ?? null,
      ctx.query.orgId,
      ctx.request,
      ctx.context.internalAdapter,
    );
    const result = await getDbExec().execute({
      sql: `SELECT u.id, u.username, r.role
      FROM "user" u
      INNER JOIN org_members m ON LOWER(m.email) = LOWER(u.email)
      LEFT JOIN app_member_roles r
        ON r.org_id = m.org_id AND r.app_id = ? AND LOWER(r.email) = LOWER(m.email)
      WHERE m.org_id = ? AND m.federation_removal_pending_at IS NULL
        AND u.username IS NOT NULL
      ORDER BY LOWER(u.username), u.id`,
      args: [FAFS_APP_ROLES.appId, ctx.query.orgId],
    });
    return ctx.json({
      users: result.rows.map((row) => ({
        id: String(row.id),
        username: String(row.username),
        role: String(row.role ?? ""),
      })),
    });
  },
);

const createUser = createAuthEndpoint(
  "/fafs/users",
  {
    method: "POST",
    body: organizationSchema.extend({
      username: usernameSchema,
      password: passwordSchema,
      role: roleSchema,
    }),
    use: accountSessionMiddleware,
  },
  async (ctx) => {
    const actor = await requireManager(
      ctx.context.session?.user ?? null,
      ctx.body.orgId,
      ctx.request,
      ctx.context.internalAdapter,
    );
    const username = ctx.body.username.toLowerCase();
    const email = internalEmail(username);
    const db = getDbExec();
    const existing = await db.execute({
      sql: `SELECT 1 FROM "user" WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1`,
      args: [username, email],
    });
    if (existing.rows.length) {
      throw APIError.from("CONFLICT", {
        code: "USERNAME_TAKEN",
        message: "That username is already in use.",
      });
    }

    const organization = await db.execute({
      sql: "SELECT 1 FROM organizations WHERE id = ? LIMIT 1",
      args: [ctx.body.orgId],
    });
    if (!organization.rows.length) {
      throw APIError.from("NOT_FOUND", {
        code: "ORGANIZATION_NOT_FOUND",
        message: "The selected organization was not found.",
      });
    }
    if (!db.transaction) {
      throw new Error(
        "Account creation requires database transaction support.",
      );
    }

    const passwordHash = await ctx.context.password.hash(ctx.body.password);
    let userId: string | undefined;
    try {
      const user = await ctx.context.internalAdapter.createUser(
        {
          email,
          name: username,
          emailVerified: true,
        },
        { method: "admin" },
      );
      userId = user.id;
      await db.execute({
        sql: `UPDATE "user" SET username = ? WHERE id = ?`,
        args: [username, userId],
      });
      const linkAccount = ctx.context.internalAdapter.linkAccount;
      if (!linkAccount) {
        throw new Error(
          "Better Auth cannot link credential accounts in this runtime.",
        );
      }
      await linkAccount({
        userId,
        providerId: "credential",
        accountId: userId,
        password: passwordHash,
      });

      await db.transaction(async (tx) => {
        await tx.execute({
          sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
          VALUES (?, ?, ?, 'member', ?)`,
          args: [
            randomUUID().replace(/-/g, ""),
            ctx.body.orgId,
            email,
            Date.now(),
          ],
        });
        await tx.execute({
          sql: `INSERT INTO app_member_roles
          (id, org_id, app_id, email, role, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            randomUUID().replace(/-/g, ""),
            ctx.body.orgId,
            FAFS_APP_ROLES.appId,
            email,
            ctx.body.role,
            actor.email,
            Date.now(),
          ],
        });
      });
    } catch (error) {
      if (userId) {
        try {
          await ctx.context.internalAdapter.deleteUser(userId);
        } catch (cleanupError) {
          console.error(
            "[fafs] Failed to remove an incomplete account after creation failed.",
            cleanupError,
          );
        }
      }
      throw error;
    }
    return ctx.json({ ok: true });
  },
);

const updateRole = createAuthEndpoint(
  "/fafs/users/role",
  {
    method: "POST",
    body: organizationSchema.extend({
      userId: z.string().min(1).max(200),
      role: roleSchema,
    }),
    use: accountSessionMiddleware,
  },
  async (ctx) => {
    const actor = await requireManager(
      ctx.context.session?.user ?? null,
      ctx.body.orgId,
      ctx.request,
      ctx.context.internalAdapter,
    );
    const target = await requireOrgUser(ctx.body.orgId, ctx.body.userId);
    await replaceRole(ctx.body.orgId, target.email, ctx.body.role, actor.email);
    return ctx.json({ ok: true });
  },
);

const updateUsername = createAuthEndpoint(
  "/fafs/users/username",
  {
    method: "POST",
    body: organizationSchema.extend({
      userId: z.string().min(1).max(200),
      username: usernameSchema,
    }),
    use: accountSessionMiddleware,
  },
  async (ctx) => {
    await requireManager(
      ctx.context.session?.user ?? null,
      ctx.body.orgId,
      ctx.request,
      ctx.context.internalAdapter,
    );
    const target = await requireOrgUser(ctx.body.orgId, ctx.body.userId);
    const username = ctx.body.username.toLowerCase();
    const conflict = await getDbExec().execute({
      sql: `SELECT 1 FROM "user"
      WHERE LOWER(username) = LOWER(?) AND id <> ? LIMIT 1`,
      args: [username, ctx.body.userId],
    });
    if (conflict.rows.length) {
      throw APIError.from("CONFLICT", {
        code: "USERNAME_TAKEN",
        message: "That username is already in use.",
      });
    }

    await getDbExec().execute({
      sql: `UPDATE "user"
      SET username = ?, name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      args: [username, username, ctx.body.userId],
    });
    return ctx.json({ ok: true });
  },
);

const resetPassword = createAuthEndpoint(
  "/fafs/users/password",
  {
    method: "POST",
    body: organizationSchema.extend({
      userId: z.string().min(1).max(200),
      password: passwordSchema,
    }),
    use: accountSessionMiddleware,
  },
  async (ctx) => {
    await requireManager(
      ctx.context.session?.user ?? null,
      ctx.body.orgId,
      ctx.request,
      ctx.context.internalAdapter,
    );
    await requireOrgUser(ctx.body.orgId, ctx.body.userId);
    const passwordHash = await ctx.context.password.hash(ctx.body.password);
    await ctx.context.internalAdapter.updatePassword(
      ctx.body.userId,
      passwordHash,
    );
    await ctx.context.internalAdapter.deleteUserSessions(ctx.body.userId);
    return ctx.json({ ok: true });
  },
);

export const fafsUserManagementPlugin: BetterAuthPlugin = {
  id: "fafs-user-management",
  endpoints: {
    signInUsername,
    listUsers,
    createUser,
    updateRole,
    updateUsername,
    resetPassword,
  },
};

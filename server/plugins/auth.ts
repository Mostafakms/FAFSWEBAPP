import { createAuthPlugin } from "@agent-native/core/server";
import { signInJourneyInlineScript } from "@agent-native/core/shared";

import { fafsUserManagementPlugin } from "../auth/fafs-user-management.js";

const authPlugin = createAuthPlugin({
  rootAuth: true,
  mountGoogleOAuthRoutes: false,
  betterAuth: {
    plugins: [fafsUserManagementPlugin],
  },
  loginHtml: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in — FAFS Progress Control</title>
    <style>
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #f2f5f8; color: #1d2938; font: 15px/1.5 Inter, "Segoe UI", sans-serif; }
      main { width: min(100%, 420px); padding: 34px; border: 1px solid #d8e0e9; border-radius: 8px; background: #fff; box-shadow: 0 16px 44px #1b2a3912; }
      .mark { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 6px; background: #1a5f9e; color: white; font-size: 18px; font-weight: 700; }
      h1 { margin: 24px 0 4px; font-size: 22px; letter-spacing: -.03em; }
      p { margin: 0 0 22px; color: #637184; font-size: 13px; }
      label { display: block; margin: 15px 0 6px; color: #46566a; font-size: 12px; font-weight: 600; }
      input { width: 100%; height: 42px; padding: 0 11px; border: 1px solid #cbd5df; border-radius: 4px; color: inherit; font: inherit; }
      input:focus { outline: 2px solid #2876b8; outline-offset: 1px; }
      button { width: 100%; height: 42px; margin-top: 22px; border: 0; border-radius: 4px; background: #1a5f9e; color: #fff; cursor: pointer; font: inherit; font-weight: 600; }
      button:disabled { opacity: .6; cursor: wait; }
      #message { min-height: 20px; margin-top: 12px; color: #ad3030; font-size: 12px; }
      @media (max-width: 480px) { main { padding: 25px; } }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">F</div>
      <h1>FAFS Progress Control</h1>
      <p>Sign in with the username provided by your Site Manager.</p>
      <form id="login">
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required minlength="3" maxlength="30" autofocus>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Sign in</button>
        <div id="message" role="alert" aria-live="polite"></div>
      </form>
    </main>
    <script>${signInJourneyInlineScript()}</script>
    <script>
      (function () {
        var journey = __anCreateSignInJourney("", "/");
        var resumeHref = journey.journeyForLocation(window.location).resumeHref;
        var form = document.getElementById("login");
        var button = form.querySelector("button");
        var message = document.getElementById("message");
        form.addEventListener("submit", async function (event) {
          event.preventDefault();
          button.disabled = true;
          message.textContent = "";
          try {
            var response = await fetch("/_agent-native/auth/ba/sign-in/username", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: form.username.value,
                password: form.password.value
              })
            });
            var result = await response.json();
            if (!response.ok || !result || !result.token) throw new Error("invalid_credentials");
            window.location.replace(resumeHref);
          } catch (_error) {
            message.textContent = "Unable to sign in. Check your username and password.";
            button.disabled = false;
          }
        });
      })();
    </script>
  </body>
</html>`,
});

export default async function configureAuth(
  nitroApp: Parameters<typeof authPlugin>[0],
) {
  const db = (await import("@agent-native/core/db")).getDbExec();
  await db.execute({
    sql: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS username TEXT`,
  });
  const missing = await db.execute({
    sql: `SELECT id, email FROM "user"
      WHERE username IS NULL OR username = ''
      ORDER BY LOWER(email), id`,
  });
  const existing = await db.execute({
    sql: `SELECT username FROM "user" WHERE username IS NOT NULL AND username <> ''`,
  });
  const used = new Set(
    existing.rows.map((row) => String(row.username).toLowerCase()),
  );

  for (const row of missing.rows) {
    const localPart = String(row.email).split("@", 1)[0] ?? "";
    const stem = localPart
      .toLowerCase()
      .replace(/[^a-z0-9_.]/g, "_")
      .slice(0, 24);
    const base = stem.length >= 3 ? stem : `user_${stem}`;
    let usernameValue = base;
    let suffix = 2;
    while (used.has(usernameValue)) {
      usernameValue = `${base.slice(0, 30 - String(suffix).length)}${suffix}`;
      suffix += 1;
    }
    await db.execute({
      sql: `UPDATE "user" SET username = ? WHERE id = ? AND (username IS NULL OR username = '')`,
      args: [usernameValue, String(row.id)],
    });
    used.add(usernameValue);
  }

  await db.execute({
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS user_username_lower_uidx
      ON "user" (LOWER(username))
      WHERE username IS NOT NULL AND username <> ''`,
  });

  await authPlugin(nitroApp);
}

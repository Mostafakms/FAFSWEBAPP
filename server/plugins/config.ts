import { defineAppConfig } from "@agent-native/core/server";

// Refuse opt-in default plugins so a blank app doesn't boot Slack/Telegram/etc
// integration routes, Sentry error tracking, the PTY terminal, or agent
// long-term memory. `plugins.disabled` is read from getAppConfig() (this `app`
// layer), which is why it must live here and not in agent-native.json.
// Never disable agent-chat/auth/core-routes — they carry most of the app.
export default defineAppConfig({
  access: {
    // The app owns account creation through Site Manager. Framework signup
    // admission stays open so managed accounts are not blocked by invitations;
    // public registration endpoints are explicitly denied in auth middleware.
    signup: "open",
  },
  plugins: {
    disabled: ["integrations", "observational-memory", "sentry", "terminal"],
  },
  app: {
    name: "FAFS Progress Control",
    homePath: "/",
  },
});

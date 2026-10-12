# FAFS Progress Control

FAFS Progress Control tracks fire-alarm implementation progress across project
facilities. Site Managers manage project setup and access, Supervisors update
building progress, and View only users can inspect dashboards, reports, and
history.

Only a Site Manager can create accounts. In People & access, create each
account with a username, password, and role: Site Manager, Supervisor, or View
only. Site Managers can change usernames and roles and reset passwords.
Registration, email invitations, and self-service password changes/resets are
disabled. Users sign in with their username and password.

For local role testing, keep the Site Manager session open in one browser
profile. Create separate Supervisor and View only accounts in People & access,
then sign in as each account in a private window (or a second browser profile)
at the local app URL. This lets you verify that Supervisors can update building
progress but cannot manage project settings or accounts, while View only users
can inspect data but cannot save changes. The local development session is a
Site Manager so it can also be used to verify administrator controls.

## Develop locally

```bash
cp .env.example .env
corepack enable
pnpm install
pnpm dev
```

`.env.example` sets `AUTH_DISABLED=true` as a commented-out option; uncomment it
to skip sign-in while developing. Leave it disabled when testing access levels:
the shortcut signs local requests in as the development identity instead of
exercising username/password role assignments.

## Project layout

- `app/`: routes and UI components
- `actions/`: operations shared by the UI and the app's agent
- `server/`: server plugins and the database client
- `drizzle/`: schema and migrations; start with `drizzle/START_HERE.md`

Framework docs: [agent-native.com/docs](https://agent-native.com/docs?utm_source=github&utm_medium=referral&utm_content=fusion-starter-readme).

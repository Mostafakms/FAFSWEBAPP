import { appPath } from "@agent-native/core/client/api-path";
import {
  IconKey,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconUser,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

const roles = [
  { value: "site_manager", label: "Site Manager" },
  { value: "supervisor", label: "Supervisor" },
  { value: "view_only", label: "View only" },
] as const;

type FafsRole = (typeof roles)[number]["value"] | "";
type UserAccount = { id: string; username: string; role: FafsRole };

async function request<T>(
  path: string,
  body?: Record<string, string>,
): Promise<T> {
  const response = await fetch(appPath(path), {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseText = await response.text();
  let payload: ({ message?: unknown; error?: unknown } & T) | undefined;
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as {
        message?: unknown;
        error?: unknown;
      } & T;
    } catch {
      if (response.ok) {
        throw new Error("The account service returned an invalid response.");
      }
    }
  }
  if (!response.ok) {
    const message =
      response.status < 500 && typeof payload?.message === "string"
        ? payload.message
        : "The account request failed. Please try again.";
    throw new Error(message);
  }
  if (!payload) {
    throw new Error("The account service returned an empty response.");
  }
  return payload;
}

export default function UserManagementSection({ orgId }: { orgId: string }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<FafsRole>("view_only");
  const [passwordUserId, setPasswordUserId] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refreshUsers() {
    if (!orgId) {
      setError("No active organization is available for account management.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await request<{ users: UserAccount[] }>(
        `/_agent-native/auth/ba/fafs/users?orgId=${encodeURIComponent(orgId)}`,
      );
      setUsers(result.users);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load accounts.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshUsers();
  }, [orgId]);

  async function createAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request("/_agent-native/auth/ba/fafs/users", {
        orgId,
        username: newUsername,
        password: newPassword,
        role: newRole,
      });
      setNewUsername("");
      setNewPassword("");
      setNewRole("view_only");
      setStatus("Account created.");
      await refreshUsers();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create the account.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveUsername(user: UserAccount) {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request("/_agent-native/auth/ba/fafs/users/username", {
        orgId,
        userId: user.id,
        username: user.username,
      });
      setStatus(`Username updated for ${user.username}.`);
      await refreshUsers();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update the username.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveRole(user: UserAccount) {
    if (!user.role) return;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request("/_agent-native/auth/ba/fafs/users/role", {
        orgId,
        userId: user.id,
        role: user.role,
      });
      setStatus(`Access level updated for ${user.username}.`);
      await refreshUsers();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update the access level.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setStatus("");
    try {
      await request("/_agent-native/auth/ba/fafs/users/password", {
        orgId,
        userId: passwordUserId,
        password: passwordDraft,
      });
      const username =
        users.find((user) => user.id === passwordUserId)?.username ?? "account";
      setPasswordDraft("");
      setPasswordUserId("");
      setStatus(
        `Password reset for ${username}. The account has been signed out on other devices.`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to reset the password.",
      );
    } finally {
      setSaving(false);
    }
  }

  function updateUser(userId: string, changes: Partial<UserAccount>) {
    setUsers((current) =>
      current.map((user) =>
        user.id === userId ? { ...user, ...changes } : user,
      ),
    );
  }

  return (
    <div className="page-content">
      <section className="page-heading-row">
        <div>
          <div className="section-kicker">
            <span className="kicker-square" /> ACCESS CONTROL
          </div>
          <h1>People &amp; access</h1>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => void refreshUsers()}
          disabled={loading}
        >
          <IconRefresh size={15} /> Refresh
        </button>
      </section>

      <section
        className="panel settings-panel"
        aria-labelledby="create-account-title"
      >
        <div className="form-panel-heading">
          <h2 id="create-account-title">
            <IconPlus size={15} /> Create an account
          </h2>
        </div>
        <form className="settings-form" onSubmit={createAccount}>
          <div className="form-grid three-cols">
            <label className="field">
              <span>Username</span>
              <input
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                autoComplete="off"
                minLength={3}
                maxLength={30}
                pattern="[A-Za-z0-9_.]+"
                required
              />
            </label>
            <label className="field">
              <span>Initial password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <label className="field">
              <span>Access level</span>
              <select
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as FafsRole)}
                required
              >
                {roles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <span className="settings-save-note">
              Use 8–128 characters for passwords.
            </span>
            <button
              type="submit"
              className="button-primary"
              disabled={saving || !orgId}
            >
              <IconUser size={15} /> {saving ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {status && (
        <div role="status" className="notice-banner">
          <IconShieldCheck size={16} />
          {status}
        </div>
      )}

      <section className="panel list-panel" aria-label="Project accounts">
        <div className="list-toolbar">
          <strong>Project accounts</strong>
          <span className="result-count">
            {loading ? "Loading…" : `${users.length} accounts`}
          </span>
        </div>
        {loading ? (
          <div className="empty-inline">
            <span className="empty-dot" />
            <span>
              <strong>Loading accounts</strong>
            </span>
          </div>
        ) : users.length === 0 ? (
          <div className="empty-inline">
            <span className="empty-dot" />
            <span>
              <strong>No accounts yet</strong>
              <small>
                Create a username and assign its project access above.
              </small>
            </span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Access level</th>
                  <th>Account security</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <input
                        aria-label={`Username for ${user.username}`}
                        value={user.username}
                        onChange={(event) =>
                          updateUser(user.id, { username: event.target.value })
                        }
                        minLength={3}
                        maxLength={30}
                        pattern="[A-Za-z0-9_.]+"
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Access level for ${user.username}`}
                        value={user.role}
                        onChange={(event) =>
                          updateUser(user.id, {
                            role: event.target.value as FafsRole,
                          })
                        }
                      >
                        <option value="">No project access</option>
                        {roles.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => {
                          setPasswordUserId(user.id);
                          setPasswordDraft("");
                        }}
                      >
                        <IconKey size={14} /> Reset password
                      </button>
                    </td>
                    <td>
                      <div className="user-row-actions">
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => void saveUsername(user)}
                          disabled={saving || !user.username.trim()}
                        >
                          Save username
                        </button>
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => void saveRole(user)}
                          disabled={saving || !user.role}
                        >
                          Save access
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {passwordUserId && (
        <section
          className="panel settings-panel password-reset-panel"
          aria-labelledby="reset-password-title"
        >
          <div className="form-panel-heading">
            <h2 id="reset-password-title">
              Reset password —{" "}
              {users.find((user) => user.id === passwordUserId)?.username}
            </h2>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setPasswordUserId("")}
            >
              Cancel
            </button>
          </div>
          <form className="settings-form" onSubmit={resetPassword}>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>
            <div className="form-actions">
              <span className="settings-save-note">
                The user will be signed out on other devices.
              </span>
              <button
                type="submit"
                className="button-primary"
                disabled={saving}
              >
                Reset password
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

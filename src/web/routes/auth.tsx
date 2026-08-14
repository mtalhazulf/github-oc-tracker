import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { Store } from "../../db/store.ts";
import { ValidationError } from "../../domain/errors.ts";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  type AuthService,
} from "../../services/auth.ts";
import { cookieOptions, principalOf } from "../middleware/auth.ts";
import { friendlyError, page, partial } from "../http.tsx";
import { Layout } from "../views/Layout.tsx";
import { AuditPage, LoginPage, SetupPage, UsersPage } from "../views/AuthPages.tsx";
import { RolesPage } from "../views/RolesPage.tsx";

function safeNext(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function createAuthRoutes(store: Store, auth: AuthService): Hono {
  const app = new Hono();

  app.get("/setup", (c) => {
    if (!auth.needsSetup) return c.redirect("/");
    return page(c, <SetupPage errors={{}} values={{}} />);
  });

  app.post("/setup", async (c) => {
    if (!auth.needsSetup) return c.redirect("/");
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      const principal = await auth.setupOwner(body);
      const session = await auth.login(principal.email, String(body.password ?? ""));
      if (session) {
        setCookie(c, SESSION_COOKIE, session.sessionId, { ...cookieOptions, maxAge: SESSION_MAX_AGE });
        auth.audit(principal, "user.create", "user", principal.id, `owner account created`);
      }
      return c.redirect("/");
    } catch (err) {
      const values: Record<string, string> = {
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
      };
      return page(
        c,
        <SetupPage errors={err instanceof ValidationError ? err.fields : {}} values={values} />,
      );
    }
  });

  app.get("/login", (c) => {
    if (auth.needsSetup) return c.redirect("/setup");
    if (principalOf(c)) return c.redirect("/");
    return page(c, <LoginPage next={c.req.query("next")} />);
  });

  app.post("/login", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const email = String(body.email ?? "");
    const next = safeNext(String(body.next ?? ""));
    const session = await auth.login(email, String(body.password ?? ""));
    if (!session) {
      auth.audit(null, "auth.failed", "user", null, `failed sign-in for ${email}`);
      return page(c, <LoginPage error="That email and password do not match an account." email={email} />);
    }
    setCookie(c, SESSION_COOKIE, session.sessionId, { ...cookieOptions, maxAge: SESSION_MAX_AGE });
    return c.redirect(next);
  });

  app.get("/logout", (c) => {
    const sessionId = c.get("sessionId") as string | undefined;
    if (sessionId) auth.logout(sessionId);
    deleteCookie(c, SESSION_COOKIE, cookieOptions);
    return c.redirect("/login");
  });

  app.post("/logout", (c) => {
    const sessionId = c.get("sessionId") as string | undefined;
    if (sessionId) auth.logout(sessionId);
    deleteCookie(c, SESSION_COOKIE, cookieOptions);
    c.header("HX-Redirect", "/login");
    return c.text("ok");
  });

  function usersPage(c: Parameters<typeof page>[0], errors = {}, message?: string) {
    return page(
      c,
      <Layout title="Accounts" active="settings">
        <UsersPage users={store.listUsers()} employees={store.listEmployees()} errors={errors} message={message} />
      </Layout>,
    );
  }

  app.get("/settings/users", (c) => usersPage(c));

  app.post("/settings/users", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      const created = await auth.createUser(body);
      auth.audit(principalOf(c), "user.create", "user", created.id, `${created.email} as ${created.role}`);
      return usersPage(c);
    } catch (err) {
      return usersPage(
        c,
        err instanceof ValidationError ? err.fields : {},
        err instanceof ValidationError ? undefined : friendlyError(err),
      );
    }
  });

  app.post("/settings/users/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const actor = principalOf(c);
    if (!actor) return c.text("Sign in to continue.", 403);
    try {
      auth.updateUser(id, body, actor);
      auth.audit(actor, "user.role_change", "user", id, `role set to ${String(body.role ?? "")}`);
      return usersPage(c);
    } catch (err) {
      return usersPage(c, {}, friendlyError(err));
    }
  });

  app.delete("/settings/users/:id", (c) => {
    const actor = principalOf(c);
    if (!actor) return c.text("Sign in to continue.", 403);
    const id = Number(c.req.param("id"));
    try {
      auth.removeUser(id, actor);
      auth.audit(actor, "user.delete", "user", id, null);
      return usersPage(c);
    } catch (err) {
      return usersPage(c, {}, friendlyError(err));
    }
  });

  app.get("/settings/roles", (c) =>
    page(
      c,
      <Layout title="Roles" active="settings">
        <RolesPage current={principalOf(c)?.role ?? "member"} />
      </Layout>,
    ),
  );

  app.get("/settings/audit", (c) => {
    const entity = c.req.query("entity") ?? "";
    return page(
      c,
      <Layout title="Audit log" active="settings">
        <AuditPage
          rows={store.listAudit({ entity: entity || undefined, limit: 200 })}
          entities={store.auditEntities()}
          entity={entity}
        />
      </Layout>,
    );
  });

  return app;
}

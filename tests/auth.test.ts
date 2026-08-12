import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore } from "../src/db/store.ts";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors.ts";
import { createAuthService, requireCap, tokensMatch } from "../src/services/auth.ts";

function setup() {
  const store = createStore(createDb(":memory:"));
  return { store, auth: createAuthService(store) };
}

const OWNER = { name: "Talha", email: "talha@house.pk", password: "correct-horse-battery" };

async function withOwner() {
  const ctx = setup();
  const owner = await ctx.auth.setupOwner(OWNER);
  return { ...ctx, owner };
}

describe("first-boot setup", () => {
  test("a fresh database needs setup", () => {
    const { auth } = setup();
    expect(auth.needsSetup).toBe(true);
  });

  test("setup creates exactly one owner and then refuses", async () => {
    const { auth, owner } = await withOwner();
    expect(owner.role).toBe("owner");
    expect(auth.needsSetup).toBe(false);
    await expect(auth.setupOwner(OWNER)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a short password is rejected", async () => {
    const { auth } = setup();
    await expect(auth.setupOwner({ ...OWNER, password: "short" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("login", () => {
  test("correct credentials open a session", async () => {
    const { auth } = await withOwner();
    const session = await auth.login(OWNER.email, OWNER.password);
    expect(session).not.toBeNull();
    expect(session?.principal.email).toBe(OWNER.email);
    expect(session?.sessionId.length).toBeGreaterThan(20);
    expect(session?.csrfToken.length).toBeGreaterThan(20);
  });

  test("a wrong password fails", async () => {
    const { auth } = await withOwner();
    expect(await auth.login(OWNER.email, "wrong-password-here")).toBeNull();
  });

  test("an unknown email fails without leaking that it is unknown", async () => {
    const { auth } = await withOwner();
    expect(await auth.login("nobody@house.pk", "correct-horse-battery")).toBeNull();
  });

  test("the password is never stored in the clear", async () => {
    const { store } = await withOwner();
    const user = store.getUserByEmail(OWNER.email);
    expect(user?.password_hash).not.toContain(OWNER.password);
    expect(user?.password_hash.startsWith("$argon2")).toBe(true);
  });

  test("a session resolves, and stops resolving after logout", async () => {
    const { auth } = await withOwner();
    const session = await auth.login(OWNER.email, OWNER.password);
    expect(auth.resolveSession(session?.sessionId ?? "")?.principal.email).toBe(OWNER.email);
    auth.logout(session?.sessionId ?? "");
    expect(auth.resolveSession(session?.sessionId ?? "")).toBeNull();
  });

  test("an expired session does not resolve", async () => {
    const { store, auth } = await withOwner();
    const user = store.getUserByEmail(OWNER.email);
    store.insertSession({
      id: "expired-session",
      userId: user?.id ?? 0,
      csrfToken: "t",
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    expect(auth.resolveSession("expired-session")).toBeNull();
  });

  test("a disabled account cannot sign in", async () => {
    const { store, auth, owner } = await withOwner();
    const member = await auth.createUser({
      name: "Member",
      email: "m@house.pk",
      password: "another-long-password",
      role: "member",
    });
    auth.updateUser(member.id, { name: "Member", role: "member", status: "disabled" }, owner);
    expect(await auth.login("m@house.pk", "another-long-password")).toBeNull();
    expect(store.listUsers().find((u) => u.id === member.id)?.status).toBe("disabled");
  });
});

describe("account management", () => {
  test("duplicate emails are refused", async () => {
    const { auth } = await withOwner();
    await expect(
      auth.createUser({ name: "X", email: OWNER.email, password: "a-long-password-x", role: "admin" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("the only owner cannot be demoted or deleted", async () => {
    const { auth, owner } = await withOwner();
    expect(() => auth.updateUser(owner.id, { name: "Talha", role: "admin" }, owner)).toThrow(ConflictError);
    expect(() => auth.removeUser(owner.id, owner)).toThrow(ConflictError);
  });

  test("you cannot delete your own account", async () => {
    const { auth, owner } = await withOwner();
    await auth.createUser({ name: "Two", email: "two@house.pk", password: "another-long-pass", role: "owner" });
    expect(() => auth.removeUser(owner.id, owner)).toThrow(/your own account/);
  });

  test("changing a password invalidates existing sessions", async () => {
    const { auth, owner } = await withOwner();
    const session = await auth.login(OWNER.email, OWNER.password);
    await auth.setPassword(owner.id, "a-brand-new-password");
    expect(auth.resolveSession(session?.sessionId ?? "")).toBeNull();
    expect(await auth.login(OWNER.email, "a-brand-new-password")).not.toBeNull();
  });
});

describe("capabilities", () => {
  test("requireCap enforces the matrix", async () => {
    const { auth } = await withOwner();
    const member = await auth.createUser({
      name: "Member",
      email: "member@house.pk",
      password: "a-long-password-yes",
      role: "member",
    });
    expect(() => requireCap(member, "payroll.manage")).toThrow(ForbiddenError);
    expect(() => requireCap(member, "compensation.view")).toThrow(ForbiddenError);
    expect(requireCap(member, "code.view").id).toBe(member.id);
  });

  test("no principal is refused", () => {
    expect(() => requireCap(null, "code.view")).toThrow(ForbiddenError);
  });
});

describe("csrf tokens", () => {
  test("match only when equal", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
    expect(tokensMatch("abc123", "abc124")).toBe(false);
    expect(tokensMatch("abc", "abcdef")).toBe(false);
    expect(tokensMatch("", "")).toBe(true);
  });
});

describe("audit log", () => {
  test("records who did what", async () => {
    const { store, auth, owner } = await withOwner();
    auth.audit(owner, "compensation.create", "employee", 7, "salary added");
    const rows = store.listAudit();
    expect(rows[0]).toMatchObject({
      action: "compensation.create",
      entity: "employee",
      entity_id: 7,
      user_email: OWNER.email,
    });
  });

  test("filters by entity", async () => {
    const { store, auth, owner } = await withOwner();
    auth.audit(owner, "a", "employee", 1, null);
    auth.audit(owner, "b", "project", 2, null);
    expect(store.listAudit({ entity: "project" })).toHaveLength(1);
    expect(store.auditEntities().sort()).toEqual(["employee", "project"]);
  });
});

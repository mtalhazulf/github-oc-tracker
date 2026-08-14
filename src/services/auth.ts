import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "../db/store.ts";
import type { UserRow } from "../db/stores/auth.ts";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors.ts";
import { can, isRole, type Capability, type Role } from "../domain/rbac.ts";
import { validator } from "../domain/validate.ts";

const SESSION_DAYS = 14;
const SESSION_SECONDS = SESSION_DAYS * 86_400;

export interface Principal {
  id: number;
  email: string;
  name: string;
  role: Role;
  employeeId: number | null;
}

export function toPrincipal(user: UserRow): Principal {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    employeeId: user.employee_id,
  };
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

export function createAuthService(store: Store) {
  return {
    get needsSetup(): boolean {
      return store.countUsers() === 0;
    },

    async setupOwner(body: Record<string, unknown>): Promise<Principal> {
      if (store.countUsers() > 0) {
        throw new ForbiddenError("Setup has already been completed.");
      }
      const { email, name, password } = parseCredentials(body, { requirePassword: true });
      const id = store.insertUser({
        email,
        name,
        passwordHash: await Bun.password.hash(password),
        role: "owner",
        employeeId: null,
      });
      const user = store.getUser(id);
      if (!user) throw new NotFoundError("The account");
      return toPrincipal(user);
    },

    async createUser(body: Record<string, unknown>): Promise<Principal> {
      const { email, name, password } = parseCredentials(body, { requirePassword: true });
      const roleRaw = String(body.role ?? "member");
      if (!isRole(roleRaw)) {
        throw new ValidationError("Choose a valid role.", { role: "Choose a valid role." });
      }
      if (store.getUserByEmail(email)) {
        throw new ConflictError(`An account already exists for ${email}.`);
      }
      const employeeIdRaw = Number(body.employee_id);
      const employeeId = Number.isFinite(employeeIdRaw) && employeeIdRaw > 0 ? employeeIdRaw : null;
      const id = store.insertUser({
        email,
        name,
        passwordHash: await Bun.password.hash(password),
        role: roleRaw,
        employeeId,
      });
      const user = store.getUser(id);
      if (!user) throw new NotFoundError("The account");
      return toPrincipal(user);
    },

    updateUser(id: number, body: Record<string, unknown>, actor: Principal): void {
      const user = store.getUser(id);
      if (!user) throw new NotFoundError("That account");
      const roleRaw = String(body.role ?? user.role);
      if (!isRole(roleRaw)) {
        throw new ValidationError("Choose a valid role.", { role: "Choose a valid role." });
      }
      if (user.role === "owner" && roleRaw !== "owner" && this.countOwners() === 1) {
        throw new ConflictError("This is the only owner account — promote someone else first.");
      }
      if (user.id === actor.id && roleRaw !== actor.role) {
        throw new ConflictError("You cannot change your own role.");
      }
      const status = String(body.status ?? user.status) === "disabled" ? "disabled" : "active";
      const employeeIdRaw = Number(body.employee_id);
      store.updateUser(id, {
        name: String(body.name ?? user.name).trim() || user.name,
        role: roleRaw,
        employeeId: Number.isFinite(employeeIdRaw) && employeeIdRaw > 0 ? employeeIdRaw : null,
        status,
      });
      if (status === "disabled") store.deleteSessionsForUser(id);
    },

    async setPassword(id: number, password: string): Promise<void> {
      if (password.length < 10) {
        throw new ValidationError("Use at least 10 characters.", { password: "Use at least 10 characters." });
      }
      store.setPassword(id, await Bun.password.hash(password));
      store.deleteSessionsForUser(id);
    },

    removeUser(id: number, actor: Principal): void {
      const user = store.getUser(id);
      if (!user) throw new NotFoundError("That account");
      if (user.id === actor.id) throw new ConflictError("You cannot delete your own account.");
      if (user.role === "owner" && this.countOwners() === 1) {
        throw new ConflictError("This is the only owner account.");
      }
      store.deleteUser(id);
    },

    countOwners(): number {
      return store.listUsers().filter((u) => u.role === "owner").length;
    },

    async login(
      email: string,
      password: string,
    ): Promise<{ sessionId: string; csrfToken: string; principal: Principal } | null> {
      const user = store.getUserByEmail(email.trim());
      if (!user || user.status === "disabled") {
        await Bun.password.hash(password);
        return null;
      }
      const ok = await Bun.password.verify(password, user.password_hash);
      if (!ok) return null;

      store.pruneSessions();
      const sessionId = token();
      const csrfToken = token();
      store.insertSession({
        id: sessionId,
        userId: user.id,
        csrfToken,
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      });
      store.touchLogin(user.id);
      return { sessionId, csrfToken, principal: toPrincipal(user) };
    },

    resolveSession(sessionId: string): { principal: Principal; csrfToken: string } | null {
      const session = store.getSession(sessionId);
      if (!session || session.user.status === "disabled") return null;
      return { principal: toPrincipal(session.user), csrfToken: session.csrf_token };
    },

    logout(sessionId: string): void {
      store.deleteSession(sessionId);
    },

    audit(actor: Principal | null, action: string, entity: string | null, entityId: number | null, summary: string | null): void {
      store.insertAudit({
        userId: actor?.id ?? null,
        userEmail: actor?.email ?? null,
        action,
        entity,
        entityId,
        summary,
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

export const SESSION_COOKIE = "sid";
export const SESSION_MAX_AGE = SESSION_SECONDS;

function parseCredentials(
  body: Record<string, unknown>,
  opts: { requirePassword: boolean },
): { email: string; name: string; password: string } {
  const v = validator(body);
  const email = v.email("email", { label: "Email", required: true }) ?? "";
  const name = v.text("name", { label: "Name", required: true, max: 120 });
  const password = String(body.password ?? "");
  if (opts.requirePassword && password.length < 10) {
    v.check(false, "password", "Use at least 10 characters.");
  }
  v.done(null);
  return { email, name, password };
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireCap(principal: Principal | null, capability: Capability): Principal {
  if (!principal) throw new ForbiddenError("Sign in to continue.");
  if (!can(principal.role, capability)) {
    throw new ForbiddenError("Your role does not have access to that.");
  }
  return principal;
}

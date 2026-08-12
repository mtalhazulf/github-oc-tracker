import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_ROLE, type Role } from "../domain/rbac.ts";
import type { Principal } from "../services/auth.ts";

/**
 * Per-request context for server-rendered views.
 *
 * The layout and sidebar need the signed-in user (to filter navigation by role)
 * and the CSRF token (to attach to every HTMX request). Threading both through
 * every page component as props would touch two dozen call sites and be easy to
 * forget on a new one — a forgotten CSRF prop is a page whose buttons silently
 * 403. AsyncLocalStorage scopes them to the request instead.
 */
export interface RequestContext {
  principal: Principal | null;
  csrfToken: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentPrincipal(): Principal | null {
  return storage.getStore()?.principal ?? null;
}

/** The acting role. Before accounts exist (fresh install) this is the owner. */
export function currentRole(): Role {
  return storage.getStore()?.principal?.role ?? DEFAULT_ROLE;
}

export function currentCsrfToken(): string | null {
  return storage.getStore()?.csrfToken ?? null;
}

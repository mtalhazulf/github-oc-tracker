import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_ROLE, type Role } from "../domain/rbac.ts";
import type { Principal } from "../services/auth.ts";

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

export function setPrincipal(principal: Principal | null): void {
  const store = storage.getStore();
  if (store) store.principal = principal;
}

export function currentRole(): Role {
  return storage.getStore()?.principal?.role ?? DEFAULT_ROLE;
}

export function currentCsrfToken(): string | null {
  return storage.getStore()?.csrfToken ?? null;
}

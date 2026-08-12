import type { Principal } from "../services/auth.ts";

/** Typed `c.get()` / `c.set()` keys used by the session middleware. */
declare module "hono" {
  interface ContextVariableMap {
    user: Principal;
    csrfToken: string;
    sessionId: string;
  }
}

import type { Principal } from "../services/auth.ts";

declare module "hono" {
  interface ContextVariableMap {
    user: Principal;
    csrfToken: string;
    sessionId: string;
  }
}

import type { Context } from "hono";
import { DEFAULT_ROLE, type Role, isRole } from "../domain/rbac.ts";

/**
 * The acting user's role for this request.
 *
 * Until accounts land (Phase 3) there is no session and every request acts as
 * owner. Reading it through one function means the switch-over is a single
 * change here rather than a search across every route.
 */
export function currentRole(c: Context): Role {
  const user = c.get("user") as { role?: string } | undefined;
  if (user?.role && isRole(user.role)) return user.role;
  return DEFAULT_ROLE;
}

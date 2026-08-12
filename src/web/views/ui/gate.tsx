import type { Child } from "hono/jsx";
import { can, type Capability } from "../../../domain/rbac.ts";
import { currentRole } from "../../request-context.ts";

/**
 * Render children only when the acting role holds the capability.
 *
 * This is presentation, not protection — the policy gate in
 * middleware/rbac.ts is what actually stops the request. Hiding a button the
 * user cannot use just avoids offering an action that would only fail.
 */
export function Can({ do: capability, children }: { do: Capability; children: Child }) {
  return can(currentRole(), capability) ? <>{children}</> : null;
}

export function allowed(capability: Capability): boolean {
  return can(currentRole(), capability);
}

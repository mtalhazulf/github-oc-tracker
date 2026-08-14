import type { Child } from "hono/jsx";
import { can, type Capability } from "../../../domain/rbac.ts";
import { currentRole } from "../../request-context.ts";

export function Can({ do: capability, children }: { do: Capability; children: Child }) {
  return can(currentRole(), capability) ? <>{children}</> : null;
}

export function allowed(capability: Capability): boolean {
  return can(currentRole(), capability);
}

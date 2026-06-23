import { DEFAULT_ROLE, isRole, type Role } from "@/db/permissions";

/**
 * Request context. `workspaceId` is the tenant the signed-in user belongs to,
 * and `role` is their permission level.
 *
 * In production these come from the authenticated session (we use better-auth).
 * Here they're MOCKED — derived from the `x-workspace` and `x-role` headers (set
 * by the UI switchers) so you can flip tenant AND role instantly and verify
 * isolation + permissions from every side. Only authentication is stubbed:
 * authorization — enforcing what a given `ctx` may read — is real and identical
 * whether `ctx` comes from a header or a verified session.
 */
export type Context = {
  workspaceId: string;
  role: Role;
};

export const DEFAULT_WORKSPACE_ID = "brightwave";

/** Single source of truth for deriving tenant + role from a request. */
export function tenantFromHeaders(req: Request): Context {
  const workspaceId =
    req.headers.get("x-workspace")?.trim() || DEFAULT_WORKSPACE_ID;
  const roleHeader = req.headers.get("x-role")?.trim() ?? "";
  // Fail CLOSED: an absent or unrecognized role falls back to least privilege
  // (DEFAULT_ROLE = "analyst"), never to admin. The demo UI opts into a higher
  // role explicitly via the Role switcher.
  const role = isRole(roleHeader) ? roleHeader : DEFAULT_ROLE;
  return { workspaceId, role };
}

export function createContext({ req }: { req: Request }): Context {
  return tenantFromHeaders(req);
}

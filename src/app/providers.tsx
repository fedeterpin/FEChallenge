"use client";

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import superjson from "superjson";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AppRouter } from "@/server/routers/app";
import { DEFAULT_WORKSPACE_ID } from "@/server/context";
import { type Role } from "@/db/permissions";

// The server fails closed to least privilege (DEFAULT_ROLE = "analyst") when no
// role is present. The demo UI explicitly opens as "admin" so candidate PII is
// visible out of the box — switch the Role selector to "analyst" to watch the
// gate engage. (Demo posture, not security posture: the server decides access.)
const INITIAL_UI_ROLE: Role = "admin";

// ---------------------------------------------------------------------------
// Active tenant + role store
//
// Both the tRPC client (via `x-workspace` / `x-role` headers on every request)
// and the chat transport need the *current* active workspace and role. They
// read this module-level ref synchronously; React state drives re-render +
// query invalidation when it changes.
// ---------------------------------------------------------------------------
const activeRef: { workspace: string; role: Role } = {
  workspace: DEFAULT_WORKSPACE_ID,
  role: INITIAL_UI_ROLE,
};

export function getActiveWorkspace(): string {
  return activeRef.workspace;
}

export function getActiveRole(): Role {
  return activeRef.role;
}

type TenantContextValue = {
  activeWorkspace: string;
  setActiveWorkspace: (workspaceId: string) => void;
  role: Role;
  setRole: (role: Role) => void;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within <Providers>");
  return ctx;
}

// ---------------------------------------------------------------------------
// tRPC + React Query
// ---------------------------------------------------------------------------
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000 },
    },
  });
}

function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        // Read the active workspace + role synchronously on every request.
        headers: () => ({
          "x-workspace": activeRef.workspace,
          "x-role": activeRef.role,
        }),
      }),
    ],
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(makeTRPCClient);
  const [activeWorkspace, setWorkspaceState] = useState(DEFAULT_WORKSPACE_ID);
  const [role, setRoleState] = useState<Role>(INITIAL_UI_ROLE);

  const value = useMemo<TenantContextValue>(
    () => ({
      activeWorkspace,
      setActiveWorkspace: (workspaceId: string) => {
        activeRef.workspace = workspaceId;
        setWorkspaceState(workspaceId);
        queryClient.invalidateQueries();
      },
      role,
      setRole: (next: Role) => {
        activeRef.role = next;
        setRoleState(next);
        queryClient.invalidateQueries();
      },
    }),
    [activeWorkspace, role, queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        <TenantContext.Provider value={value}>
          {children}
        </TenantContext.Provider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}

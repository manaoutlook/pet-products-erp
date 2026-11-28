import { useQuery } from "@tanstack/react-query";
import {
  environmentInfo,
  type EnvironmentInfo,
  type EnvironmentName,
} from "@shared/environment";

/**
 * Which deployment the browser is talking to, asked once per page load.
 *
 * The answer lives on the server (`GET /api/environment` reads `APP_ENV` from the
 * process environment) because one build serves every host - see shared/environment.ts.
 *
 * `staleTime: Infinity` on purpose: the answer cannot change while the tab is open, and
 * it is needed on the login screen before any session exists, so a refetch on focus would
 * be a request per window switch for a value that never moves.
 *
 * While the request is in flight `info` is `unknown` and `isLoading` is true - callers
 * render nothing in that window rather than flashing a wrong claim.
 */
export interface EnvironmentSnapshot {
  info: EnvironmentInfo;
  /** The address the user typed, as the server saw it (`localhost:5002`). */
  host: string | null;
  /** True until the first answer arrives. */
  isLoading: boolean;
  /** True when the request failed: `info` is then `unknown`, not a claim. */
  isError: boolean;
}

interface EnvironmentResponse {
  environment: EnvironmentName;
  host: string | null;
  nodeEnv: string | null;
}

const UNKNOWN = environmentInfo("unknown");

async function fetchEnvironment(): Promise<EnvironmentResponse> {
  const response = await fetch("/api/environment", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`environment request failed: ${response.status}`);
  }
  return (await response.json()) as EnvironmentResponse;
}

export function useEnvironment(): EnvironmentSnapshot {
  const { data, isLoading, isError } = useQuery<EnvironmentResponse>({
    queryKey: ["environment"],
    queryFn: fetchEnvironment,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return {
    info: data ? environmentInfo(data.environment) : UNKNOWN,
    host: data?.host ?? null,
    isLoading,
    isError,
  };
}

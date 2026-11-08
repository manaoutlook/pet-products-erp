import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const res = await fetch(queryKey[0] as string, {
          credentials: "include",
        });

        if (!res.ok) {
          if (res.status >= 500) {
            throw new Error(`${res.status}: ${res.statusText}`);
          }

          throw new Error(`${res.status}: ${await res.text()}`);
        }

        return res.json();
      },
      refetchInterval: false,
      // AI Agent Note: `staleTime: Infinity` + no focus refetch meant a second
      // cashier's sale never showed up until a manual reload — the data was
      // cached for the lifetime of the tab. 30s keeps ordinary navigation from
      // re-fetching every list on every click while still picking up other
      // users' writes when the window regains focus.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    }
  },
});

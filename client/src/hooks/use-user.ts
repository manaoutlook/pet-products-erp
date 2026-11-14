import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InsertUser, SelectUser } from "@db/schema";

type RequestResult = {
  message: string;
  suggestion?: string;
  user?: {
    id: number;
    username: string;
    role: {
      name: string;
    };
  };
};

/**
 * An API failure that still carries the server's advice.
 *
 * AI Agent Note: non-2xx bodies are JSON shaped `{ message, suggestion }`.
 * Throwing the raw body text put the whole JSON blob in the alert title
 * (`{"message":"Internal server error",...}`) - the sentence the user needs was
 * buried inside it. Parse it here so the login card can show the message and
 * suggestion as separate lines.
 */
export interface ApiError extends Error {
  status?: number;
  suggestion?: string;
}

function toApiError(status: number, responseText: string, statusText: string): ApiError {
  let message = responseText || statusText || 'Request failed';
  let suggestion: string | undefined;

  try {
    const payload = responseText ? JSON.parse(responseText) : null;
    if (payload && typeof payload === 'object') {
      if (typeof payload.message === 'string' && payload.message) {
        message = payload.message;
      }
      if (typeof payload.suggestion === 'string' && payload.suggestion) {
        suggestion = payload.suggestion;
      }
    }
  } catch {
    // Body was not JSON (proxy error page, empty response, ...) - the raw text
    // is still the most specific thing we have.
  }

  const error = new Error(message) as ApiError;
  error.status = status;
  if (suggestion) error.suggestion = suggestion;
  return error;
}

async function handleRequest(
  url: string,
  method: string,
  body?: InsertUser
): Promise<RequestResult> {
  try {
    console.log(`Making ${method} request to ${url}`, body ? { username: body.username } : {});

    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    const responseText = await response.text();
    console.log(`Response status: ${response.status}`, { responseText });

    if (!response.ok) {
      throw toApiError(response.status, responseText, response.statusText);
    }

    // Only try to parse as JSON if we have content
    const result = responseText ? JSON.parse(responseText) : {};
    console.log('Request successful:', { result });
    return result;
  } catch (e: any) {
    console.error('Request failed:', e);
    // Rethrow what we already shaped so `status`/`suggestion` survive the trip
    // to the caller (the login card reads `suggestion`).
    if (e instanceof Error) throw e;
    throw new Error('An error occurred');
  }
}

async function fetchUser(): Promise<SelectUser | null> {
  try {
    console.log('Fetching user data...');
    const response = await fetch('/api/user', {
      credentials: 'include'
    });

    console.log('User fetch response:', { status: response.status });

    if (!response.ok) {
      if (response.status === 401) {
        console.log('User not authenticated');
        return null;
      }
      const text = await response.text();
      throw new Error(text || response.statusText);
    }

    const userData = await response.json();
    console.log('User data fetched:', userData);
    return userData;
  } catch (e: any) {
    console.error('Error fetching user:', e);
    throw e;
  }
}

export function useUser() {
  const queryClient = useQueryClient();

  const { data: user, error, isLoading } = useQuery<SelectUser | null, Error>({
    queryKey: ['user'],
    queryFn: fetchUser,
    staleTime: Infinity,
    retry: false
  });

  const loginMutation = useMutation({
    mutationFn: (userData: InsertUser) => handleRequest('/api/login', 'POST', userData),
    onSuccess: (data) => {
      console.log('Login successful:', data);
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
    onError: (error) => {
      console.error('Login failed:', error);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: () => handleRequest('/api/logout', 'POST'),
    onSuccess: () => {
      console.log('Logout successful');
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
    onError: (error) => {
      console.error('Logout failed:', error);
    }
  });

  return {
    user,
    isLoading,
    error,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
  };
}
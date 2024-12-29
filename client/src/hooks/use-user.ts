import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InsertUser, SelectUser } from "@db/schema";

type RequestResult = {
  message: string;
  user?: {
    id: number;
    username: string;
    role: {
      name: string;
    };
  };
};

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
      throw new Error(responseText || response.statusText || 'Request failed');
    }

    // Only try to parse as JSON if we have content
    const result = responseText ? JSON.parse(responseText) : {};
    console.log('Request successful:', { result });
    return result;
  } catch (e: any) {
    console.error('Request failed:', e);
    throw new Error(e.message || 'An error occurred');
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
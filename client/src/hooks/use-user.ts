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
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }

    return response.json();
  } catch (e: any) {
    throw new Error(e.message || 'An error occurred');
  }
}

async function fetchUser(): Promise<SelectUser | null> {
  const response = await fetch('/api/user', {
    credentials: 'include'
  });

  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  return response.json();
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => handleRequest('/api/logout', 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: (userData: InsertUser) => handleRequest('/api/register', 'POST', userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });

  return {
    user,
    isLoading,
    error,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    register: registerMutation.mutateAsync,
  };
}
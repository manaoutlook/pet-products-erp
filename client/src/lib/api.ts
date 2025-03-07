// API utility functions
const API_BASE_URL = '/api';

export async function fetchData<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    // Try to parse error message from response
    try {
      const errorData = await response.json();
      throw new Error(errorData.message || `API error: ${response.status}`);
    } catch (e) {
      // If parsing fails, use generic error
      throw new Error(`API error: ${response.status}`);
    }
  }

  return response.json();
}

export async function postData<T>(endpoint: string, data: any): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    credentials: 'include',
  });

  if (!response.ok) {
    // Try to parse error message from response
    try {
      const errorData = await response.json();
      throw new Error(`API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
    } catch (e) {
      // If parsing fails, use the generic error
      throw new Error(`API error: ${response.status}`);
    }
  }

  return response.json();
}

export async function putData<T>(endpoint: string, data: any): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    credentials: 'include',
  });

  if (!response.ok) {
    // Try to parse error message from response
    try {
      const errorData = await response.json();
      throw new Error(`API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
    } catch (e) {
      // If parsing fails, use the generic error
      throw new Error(`API error: ${response.status}`);
    }
  }

  return response.json();
}

export async function deleteData<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    // Try to parse error message from response
    try {
      const errorData = await response.json();
      throw new Error(`API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
    } catch (e) {
      // If parsing fails, use generic error
      throw new Error(`API error: ${response.status}`);
    }
  }

  return response.json();
}
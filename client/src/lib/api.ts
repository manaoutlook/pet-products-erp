import { logger } from './logger';

// API utility functions
const API_BASE_URL = '/api';

export async function fetchData<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  logger.info(`Fetching data from: ${url}`);

  try {
    const response = await fetch(url, {
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const error = new Error(
        errorData?.message || `API error: ${response.status}`
      );
      logger.error(`Failed to fetch data from ${url}`, {
        status: response.status,
        errorData
      });
      throw error;
    }

    const data = await response.json();
    logger.debug(`Successfully fetched data from ${url}`, {
      status: response.status
    });
    return data;
  } catch (error) {
    logger.error(`Error fetching data from ${url}`, { error });
    throw error;
  }
}

export async function postData<T>(endpoint: string, data: any): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  logger.info(`Posting data to: ${url}`);
  logger.debug('Request payload:', { data });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const error = new Error(
        errorData?.message || `API error: ${response.status}`
      );
      logger.error(`Failed to post data to ${url}`, {
        status: response.status,
        errorData
      });
      throw error;
    }

    const responseData = await response.json();
    logger.debug(`Successfully posted data to ${url}`, {
      status: response.status
    });
    return responseData;
  } catch (error) {
    logger.error(`Error posting data to ${url}`, { error });
    throw error;
  }
}

export async function putData<T>(endpoint: string, data: any): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  logger.info(`Putting data to: ${url}`);
  logger.debug('Request payload:', { data });

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const error = new Error(
        errorData?.message || `API error: ${response.status}`
      );
      logger.error(`Failed to put data to ${url}`, {
        status: response.status,
        errorData
      });
      throw error;
    }

    const responseData = await response.json();
    logger.debug(`Successfully put data to ${url}`, {
      status: response.status
    });
    return responseData;
  } catch (error) {
    logger.error(`Error putting data to ${url}`, { error });
    throw error;
  }
}

export async function deleteData<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  logger.info(`Deleting data from: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const error = new Error(
        errorData?.message || `API error: ${response.status}`
      );
      logger.error(`Failed to delete data from ${url}`, {
        status: response.status,
        errorData
      });
      throw error;
    }

    const responseData = await response.json();
    logger.debug(`Successfully deleted data from ${url}`, {
      status: response.status
    });
    return responseData;
  } catch (error) {
    logger.error(`Error deleting data from ${url}`, { error });
    throw error;
  }
}
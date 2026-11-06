/**
 * API error helper
 *
 * The server answers failures with a `{ message, suggestion }` JSON body
 * (see server/routes.ts). Showing `await res.text()` directly dumps raw JSON
 * into toasts, so every fetch wrapper should pass the response through here.
 */

interface ApiErrorBody {
  message?: string;
  suggestion?: string;
}

export async function readApiError(res: Response): Promise<string> {
  const fallback = `Request failed (${res.status} ${res.statusText})`;

  let text: string;
  try {
    text = await res.text();
  } catch {
    return fallback;
  }

  if (!text) return fallback;

  try {
    const body = JSON.parse(text) as ApiErrorBody;
    if (body?.message) {
      return body.suggestion ? `${body.message} ${body.suggestion}` : body.message;
    }
  } catch {
    // Response was not JSON (e.g. plain-text 401 from requireAuth) - fall through.
  }

  return text;
}

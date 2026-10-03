// Merchant Brain: browser-side helper for the auth endpoints.
//
// Deliberately tiny and shared by the sign-in and sign-up forms so both
// interpret the error envelope the same way. This module is loaded in the
// browser: it imports nothing from the server half of lib/auth.

export interface AuthApiResponse<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data?: T;
  /** Message safe to show the user — written by the server, never upstream. */
  readonly message?: string;
  readonly code?: string;
}

export interface LoginResponseData {
  readonly authenticated: boolean;
}

export interface SignupResponseData {
  readonly authenticated: boolean;
  readonly needsEmailConfirmation: boolean;
}

export async function postAuthRequest<T>(
  path: string,
  body: unknown,
): Promise<AuthApiResponse<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Check your connection and try again.' };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const envelope = payload as
    | { data?: T; error?: { message?: string; code?: string } }
    | null;

  if (envelope?.error) {
    return {
      ok: false,
      status: response.status,
      message: envelope.error.message ?? 'Something went wrong. Please try again.',
      ...(envelope.error.code ? { code: envelope.error.code } : {}),
    };
  }

  if (!response.ok) {
    return { ok: false, status: response.status, message: 'Something went wrong. Please try again.' };
  }

  return { ok: true, status: response.status, ...(envelope?.data ? { data: envelope.data } : {}) };
}

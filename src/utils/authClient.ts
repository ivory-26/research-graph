export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface AuthSession {
  user: AuthUser;
}

export interface AuthResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials {
  email: string;
  password: string;
  name?: string;
}

/**
 * Neon Auth client utility to communicate with the same-origin proxy at /api/auth/*
 */
export async function signIn(
  credentials: SignInCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult<AuthSession>> {
  const { email, password } = credentials;

  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, error: 'A valid email address is required' };
  }
  if (!password) {
    return { ok: false, status: 400, error: 'Password is required' };
  }

  try {
    const res = await fetchImpl('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

    if (!res.ok) {
      const errorMsg =
        (body && typeof body.message === 'string' && body.message) ||
        (body && typeof body.error === 'string' && body.error) ||
        `Sign in failed (HTTP ${res.status})`;
      return { ok: false, status: res.status, error: errorMsg, data: body };
    }

    return { ok: true, status: res.status, data: body };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function signUp(
  credentials: SignUpCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult<AuthSession>> {
  const { email, password, name } = credentials;

  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, error: 'A valid email address is required' };
  }
  if (!password || password.length < 8) {
    return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
  }

  try {
    const res = await fetchImpl('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: name || email.split('@')[0] }),
    });

    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

    if (!res.ok) {
      const errorMsg =
        (body && typeof body.message === 'string' && body.message) ||
        (body && typeof body.error === 'string' && body.error) ||
        `Sign up failed (HTTP ${res.status})`;
      return { ok: false, status: res.status, error: errorMsg, data: body };
    }

    return { ok: true, status: res.status, data: body };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function signOut(
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult<void>> {
  try {
    const res = await fetchImpl('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: `Sign out failed (HTTP ${res.status})` };
    }

    return { ok: true, status: res.status };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getSession(
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult<AuthSession | null>> {
  try {
    const res = await fetchImpl('/api/auth/get-session', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: true, status: res.status, data: null };
    }

    if (!res.ok) {
      return { ok: false, status: res.status, error: `Failed to check session (HTTP ${res.status})` };
    }

    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

    return { ok: true, status: res.status, data: body };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

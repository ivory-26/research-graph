import { createAuthClient } from '@neon/auth';
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters';

/**
 * Neon Auth browser client configured with the documented React adapter
 * against the same-origin `/api/auth/*` proxy.
 */
export const authClient = createAuthClient('', {
  adapter: BetterAuthReactAdapter(),
});

export interface AuthResult<T = unknown> {
  ok: boolean;
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

export async function signIn(
  credentials: SignInCredentials,
  client: typeof authClient = authClient,
): Promise<AuthResult> {
  const { email, password } = credentials;

  if (!email || !email.includes('@')) {
    return { ok: false, error: 'A valid email address is required' };
  }
  if (!password) {
    return { ok: false, error: 'Password is required' };
  }

  try {
    const res = await client.signIn.email({ email, password });
    if (res?.error) {
      return {
        ok: false,
        error: res.error.message || 'Sign in failed',
      };
    }
    return { ok: true, data: res?.data };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function signUp(
  credentials: SignUpCredentials,
  client: typeof authClient = authClient,
): Promise<AuthResult> {
  const { email, password, name } = credentials;

  if (!email || !email.includes('@')) {
    return { ok: false, error: 'A valid email address is required' };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' };
  }

  try {
    const res = await client.signUp.email({
      email,
      password,
      name: name || email.split('@')[0],
    });
    if (res?.error) {
      return {
        ok: false,
        error: res.error.message || 'Sign up failed',
      };
    }
    return { ok: true, data: res?.data };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function signOut(
  client: typeof authClient = authClient,
): Promise<AuthResult<void>> {
  try {
    const res = await client.signOut();
    if (res?.error) {
      return { ok: false, error: res.error.message || 'Sign out failed' };
    }
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

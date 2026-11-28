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

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

/**
 * Reduces a caller-supplied URL to a same-origin path.
 *
 * Only a rooted path is accepted so a `redirect` search parameter can never
 * become an open redirect through the OAuth `callbackURL`. Absolute URLs are
 * resolved against `origin` and kept only when their origin matches.
 */
export function sameOriginPath(
  value: string | undefined | null,
  origin: string,
): string {
  if (!value) return '/';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return '/';
    return `${url.pathname}${url.search}${url.hash}` || '/';
  } catch {
    return '/';
  }
}

/** Result of starting a social sign-in: the URL the browser must visit. */
export interface SocialRedirect {
  url: string;
}

/**
 * Starts Google sign-in and returns the provider URL for the browser to visit.
 *
 * `disableRedirect` keeps this function side-effect free, so the caller decides
 * when to navigate (and tests never touch `window.location`). The callback is
 * forced to a same-origin path first.
 */
export async function signInWithGoogle(
  callbackURL: string | undefined,
  client: typeof authClient = authClient,
): Promise<AuthResult<SocialRedirect>> {
  const origin =
    typeof window !== 'undefined' && window.location
      ? window.location.origin
      : 'http://localhost';
  const callbackPath = sameOriginPath(callbackURL, origin);

  try {
    const res = await client.signIn.social({
      provider: 'google',
      callbackURL: callbackPath,
      disableRedirect: true,
    });
    if (res?.error) {
      return {
        ok: false,
        error: res.error.message || 'Google sign-in is not available',
      };
    }

    const url = (res?.data as { url?: unknown } | null | undefined)?.url;
    if (typeof url !== 'string' || !url) {
      return { ok: false, error: 'Google sign-in did not return a redirect URL' };
    }

    return { ok: true, data: { url } };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function signIn(
  credentials: SignInCredentials,
  client: typeof authClient = authClient,
): Promise<AuthResult> {
  const { email, password } = credentials;

  if (!EMAIL_SHAPE.test(email)) {
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

  if (!EMAIL_SHAPE.test(email)) {
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

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { sameOriginPath, signIn, signInWithGoogle } from '../utils/authClient';
import { ShieldCheck, LogIn, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

/** The Google mark, inline so the sign-in screen needs no remote asset. */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.21 7.21 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsGoogleLoading(true);

    const callbackPath = sameOriginPath(redirectTo, window.location.origin);
    const res = await signInWithGoogle(callbackPath);
    if (res.ok && res.data?.url) {
      // The provider redirect leaves the app; the callback exchange and guard
      // run on the way back (see src/start.ts).
      window.location.assign(res.data.url);
      return;
    }

    setErrorMessage(res.ok ? 'Google sign-in failed' : res.error || 'Google sign-in failed');
    setIsGoogleLoading(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const res = await signIn({ email, password });
      if (res.ok) {
        if (redirectTo) {
          try {
            const parsed = new URL(redirectTo, window.location.origin);
            if (parsed.origin === window.location.origin) {
              window.location.assign(parsed.href);
              return;
            }
          } catch {
            // Invalid redirect URL; fall through to root
          }
        }
        navigate({ to: '/' });
      } else {
        setErrorMessage(res.error || 'Sign in failed');
      }
    } catch (err: any) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-[#08090b] text-[#e5e5e5] p-4 font-sans select-none">
      <div className="w-full max-w-md border border-[#1e2229] bg-[#0d0f12] p-8 shadow-2xl rounded-none">
        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-6 border-b border-[#1e2229] pb-5">
          <div className="p-2.5 bg-[#f97316]/10 border border-[#f97316]/30 text-[#f97316] rounded-none">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold font-mono tracking-tight text-white uppercase">
              ResearchGraph
            </h1>
            <p className="text-xs text-[#888888] font-mono">
              Sign in to access your research workspace
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-5 flex items-center gap-2 border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-300 font-mono">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Google sign-in */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isLoading || isGoogleLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-[#1f2328] font-bold font-mono text-xs uppercase hover:bg-[#e6e6e6] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed rounded-none"
        >
          {isGoogleLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Redirecting to Google...</span>
            </>
          ) : (
            <>
              <GoogleMark />
              <span>Continue with Google</span>
            </>
          )}
        </button>

        <div className="my-5 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-[#1e2229]" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#666]">
            or use email
          </span>
          <span className="h-px flex-1 bg-[#1e2229]" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-[#a3a3a3] uppercase mb-1.5 tracking-wider">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="researcher@lab.org"
              className="w-full border border-[#262b33] bg-[#12151a] px-3.5 py-2.5 text-xs text-white placeholder-[#555] font-mono focus:border-[#f97316] focus:outline-none transition rounded-none"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-[#a3a3a3] uppercase mb-1.5 tracking-wider">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full border border-[#262b33] bg-[#12151a] px-3.5 py-2.5 text-xs text-white placeholder-[#555] font-mono focus:border-[#f97316] focus:outline-none transition rounded-none"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || isGoogleLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#f97316] text-black font-bold font-mono text-xs uppercase hover:bg-[#ea580c] transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed rounded-none mt-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                <span>Sign In with Neon Auth</span>
              </>
            )}
          </button>
        </form>

        {/* Footer Navigation */}
        <div className="mt-6 pt-5 border-t border-[#1e2229] flex flex-col gap-3 text-xs font-mono text-[#888888]">
          <div className="flex items-center justify-between">
            <span>Don't have an account?</span>
            <Link
              to="/sign-up"
              className="text-[#f97316] hover:underline flex items-center gap-1 font-semibold"
            >
              <span>Sign up</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {import.meta.env.DEV && (
            <div className="pt-2 text-center">
              <Link
                to="/"
                search={{ preview: 'true' }}
                className="text-[#666] hover:text-[#999] transition text-[11px] underline"
              >
                Explore workspace in preview mode
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

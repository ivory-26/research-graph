import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { signIn } from '../utils/authClient';
import { ShieldCheck, LogIn, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const res = await signIn({ email, password });
      if (res.ok) {
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
            disabled={isLoading}
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

          <div className="pt-2 text-center">
            <Link
              to="/"
              search={{ preview: 'true' }}
              className="text-[#666] hover:text-[#999] transition text-[11px] underline"
            >
              Explore workspace in preview mode
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

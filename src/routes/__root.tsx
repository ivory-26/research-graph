import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import appCss from '../styles.css?url';
import { ThemeProvider } from '../context/ThemeContext';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'ResearchGraph — AI Research Workspace',
      },
      {
        name: 'description',
        content: 'Turn paper claims into connected, executable and auditable experiments.',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  errorComponent: ({ error, reset }) => (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#08090b] text-[#e5e5e5] p-6 font-mono">
      <div className="max-w-md w-full border border-red-500/40 bg-red-950/20 p-5 space-y-3">
        <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
          <span>⚠️</span>
          <span>Workspace Error</span>
        </div>
        <p className="text-xs text-red-200/80 leading-relaxed">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <div className="pt-2 flex gap-2">
          <button
            onClick={() => reset()}
            className="px-3 py-1.5 bg-[#f97316] text-black font-bold text-xs hover:bg-[#ea580c] transition"
          >
            Retry
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 border border-[#1e2229] bg-[#121418] text-white text-xs hover:bg-[#1a1e24] transition"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  ),
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full w-full" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="h-full w-full overflow-hidden font-sans antialiased transition-colors duration-200">
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

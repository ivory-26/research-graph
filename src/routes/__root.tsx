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

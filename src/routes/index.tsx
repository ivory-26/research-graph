import { createFileRoute } from '@tanstack/react-router'

// Framework-required placeholder. The canvas workstream owns the real app shell.
export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '0 auto', maxWidth: 640, padding: '4rem 1.5rem' }}>
      <h1>ResearchGraph</h1>
      <p>The scaffold is running. The workspace UI replaces this page.</p>
    </main>
  )
}

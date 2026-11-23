import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// getRouter must return a fresh router instance for every request.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
  })
}

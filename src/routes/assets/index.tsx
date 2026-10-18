import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/assets` on its own has no project to show, and the parent route only renders an
 * Outlet — so landing here used to give a blank page. Send people to the project
 * list instead of a dead end.
 */
export const Route = createFileRoute('/assets/')({
  beforeLoad: () => {
    throw redirect({ to: '/projects' } as never);
  },
});

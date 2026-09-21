import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { meQuery } from '../api/auth.ts';
import type { RouterContext } from '../router.tsx';
import { Rail } from '../shell/Rail.tsx';
import { ToastHost } from '../shell/Toasts.tsx';
import { TopBar } from '../shell/TopBar.tsx';

export const Route = createRootRouteWithContext<RouterContext>()({
  /**
   * Who is asking, before the first paint.
   *
   * Every screen below reads it to decide what to offer, and a control that
   * arrives a tick after the page it belongs to is worse than one that was
   * never there: the wall would render without its filters and grow them. The
   * mounted `AuthStatus` still asks again on every mount, so this primes the
   * answer rather than becoming the only one.
   */
  beforeLoad: async ({ context }) => {
    // Awaited, not returned: what `beforeLoad` returns is merged into the route
    // context, and a non-reactive snapshot of `Me` sitting there would read as
    // the authoritative answer to the next person who finds it.
    await context.queryClient.ensureQueryData(meQuery);
  },
  component: Shell,
});

/**
 * Rail, then a column of chrome over content — full width, not a centred
 * measure.
 *
 * The design is an application rather than a document: it pads 18px and fills
 * the window, and a wall of posters in a 1152px strip with dead space either
 * side reads as an article about a library instead of the library.
 */
function Shell() {
  return (
    // Above the layout rather than inside `main`: a notice is about the record,
    // not about the screen that happened to be open when it was written, and it
    // has to outlive a navigation away from that screen.
    <ToastHost>
      <div className="flex min-h-dvh">
        <Rail />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 p-[18px]">
            <Outlet />
          </main>
        </div>
      </div>
    </ToastHost>
  );
}

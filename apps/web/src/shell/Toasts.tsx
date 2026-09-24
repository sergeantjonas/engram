import * as Toast from '@radix-ui/react-toast';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

/** Something that happened, said once and then got out of the way. */
export interface Notice {
  message: string;
  /**
   * The way back, where there is one. A write that can be taken back should
   * offer it here rather than somewhere the viewer has to go and find: the
   * moment they know it was wrong is the moment it is on screen.
   */
  action?: { label: string; run: () => void | Promise<void> };
}

const Post = createContext<(notice: Notice) => void>(() => {
  throw new Error('a toast was posted outside the host that draws them');
});

/** Posts a notice. Stable, so an effect can depend on it. */
export function useToast(): (notice: Notice) => void {
  return useContext(Post);
}

/**
 * The toast layer.
 *
 * Replaces reporting a write inside the panel that made it: a panel that stays
 * open to show its own answer has to be dismissed by hand afterwards, and the
 * answer is about the page rather than about the panel. Long enough to read
 * and act on, because an undo the viewer cannot reach in time is decoration.
 */
export function ToastHost({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<(Notice & { id: number })[]>([]);

  const post = useCallback((notice: Notice) => {
    // Keyed on a counter rather than the message: marking two seasons in a row
    // produces the same sentence twice, and React would treat the second as a
    // re-render of the first and never restart its timer.
    setNotices((open) => [...open, { ...notice, id: (open.at(-1)?.id ?? 0) + 1 }]);
  }, []);

  const dismiss = (id: number) => setNotices((open) => open.filter((n) => n.id !== id));

  return (
    <Post.Provider value={post}>
      <Toast.Provider swipeDirection="right">
        {children}
        {notices.map((notice) => (
          <Toast.Root
            key={notice.id}
            duration={notice.action ? 12_000 : 5_000}
            onOpenChange={(open) => {
              if (!open) dismiss(notice.id);
            }}
            className="flex items-center gap-3 rounded border border-line bg-raise px-4 py-3 text-sm text-tx shadow-lg"
          >
            <Toast.Description className="flex-1">{notice.message}</Toast.Description>
            {notice.action ? (
              <Toast.Action
                asChild
                altText={notice.action.label}
                // Radix closes the toast for us; what the action did is
                // reported by a notice of its own.
                onClick={() => void notice.action?.run()}
              >
                <button
                  type="button"
                  className="font-medium text-jade underline-offset-4 hover:underline"
                >
                  {notice.action.label}
                </button>
              </Toast.Action>
            ) : null}
            <Toast.Close aria-label="Dismiss" className="text-dim hover:text-tx">
              ×
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed right-4 bottom-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </Toast.Provider>
    </Post.Provider>
  );
}

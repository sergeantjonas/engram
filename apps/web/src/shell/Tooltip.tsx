import * as Tooltip from '@radix-ui/react-tooltip';
import { type ReactElement, type ReactNode, useState } from 'react';

/**
 * How long a pointer has to rest before a tip appears.
 *
 * Short, because these label things the viewer is scanning rather than
 * explaining things they are deciding about — a grid of episode numbers is
 * unreadable until one of them says what it is. The browser's own `title`
 * waits about a second, which is most of why it is no substitute.
 */
const DELAY_MS = 250;

/** One provider for the app; every `Tip` below reads its timing from it. */
export function TooltipHost({ children }: { children: ReactNode }) {
  // Once one tip has been shown, moving to a neighbour shows its tip at once:
  // reading along a row of cells should not cost a quarter-second each.
  return (
    <Tooltip.Provider delayDuration={DELAY_MS} skipDelayDuration={400}>
      {children}
    </Tooltip.Provider>
  );
}

/**
 * A label for something the screen had no room to say in full.
 *
 * Never the browser's `title`: that cannot be styled, cannot be placed, waits
 * about a second, disappears on a timer, and is invisible to touch entirely.
 * See web-design.md § Tooltips.
 *
 * The child must be focusable, or this is a mouse-only affordance and keyboard
 * users get nothing — where that is unavoidable, the same text has to reach
 * them some other way, and the call site should say how.
 */
export function Tip({
  label,
  hidden = false,
  children,
}: {
  label: string;
  /**
   * Suppresses the tip without unmounting it — for a trigger that also opens
   * something on click, where a tip hanging over the thing it opened is noise.
   */
  hidden?: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip.Root open={open && !hidden} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="max-w-72 rounded border border-line bg-raise px-2 py-1 text-xs text-tx shadow-lg"
        >
          {label}
          <Tooltip.Arrow className="fill-line" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

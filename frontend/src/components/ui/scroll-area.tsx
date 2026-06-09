import {
  ScrollArea as MantineScrollArea,
  type ScrollAreaProps as MantineScrollAreaProps,
} from '@mantine/core';
import React from 'react';

// ── ScrollArea ────────────────────────────────────────────────────────────────

interface ScrollAreaProps extends MantineScrollAreaProps {
  className?: string;
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => (
    <MantineScrollArea ref={ref} className={className} {...props}>
      {children}
    </MantineScrollArea>
  ),
);
ScrollArea.displayName = 'ScrollArea';

// ── ScrollBar ─────────────────────────────────────────────────────────────────
// Mantine manages its own scrollbar — this shim is a no-op.

const ScrollBar = (_props: React.HTMLAttributes<HTMLDivElement>) => null;
ScrollBar.displayName = 'ScrollBar';

export { ScrollArea, ScrollBar };

import { Popover as MantinePopover, type PopoverProps as MantinePopoverProps } from '@mantine/core';
import React from 'react';

// ── Context ───────────────────────────────────────────────────────────────────

interface PopoverContextValue {
  opened: boolean;
  setOpened: (v: boolean) => void;
}

const PopoverContext = React.createContext<PopoverContextValue>({
  opened: false,
  setOpened: () => {},
});

// ── Popover (root) ────────────────────────────────────────────────────────────

interface PopoverRootProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
  modal?: boolean;
}

const Popover = ({
  open,
  onOpenChange,
  defaultOpen = false,
  children,
  modal,
}: PopoverRootProps) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const opened = isControlled ? open! : internalOpen;

  const setOpened = React.useCallback(
    (v: boolean) => {
      if (!isControlled) setInternalOpen(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange],
  );

  return (
    <PopoverContext.Provider value={{ opened, setOpened }}>
      <MantinePopover opened={opened} onChange={setOpened} trapFocus={modal}>
        {children}
      </MantinePopover>
    </PopoverContext.Provider>
  );
};
Popover.displayName = 'Popover';

// ── PopoverTrigger ────────────────────────────────────────────────────────────

interface PopoverTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
}

const PopoverTrigger = ({ children, asChild }: PopoverTriggerProps) => {
  if (asChild && React.isValidElement(children)) {
    return <MantinePopover.Target>{children}</MantinePopover.Target>;
  }
  return <MantinePopover.Target>{children}</MantinePopover.Target>;
};
PopoverTrigger.displayName = 'PopoverTrigger';

// ── PopoverContent ────────────────────────────────────────────────────────────

interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  ({ className, children, align = 'center', sideOffset: _s, side, ...props }, ref) => {
    const position = side as MantinePopoverProps['position'] | undefined;
    return (
      <MantinePopover.Dropdown
        ref={ref}
        className={className}
        {...(position ? { 'data-side': position } : {})}
        {...props}
      >
        {children}
      </MantinePopover.Dropdown>
    );
  },
);
PopoverContent.displayName = 'PopoverContent';

export { Popover, PopoverContent, PopoverTrigger };

import { Collapse, type CollapseProps } from '@mantine/core';
import React from 'react';

// ── Collapsible ───────────────────────────────────────────────────────────────
// Provides the same API as Shadcn's Collapsible (open + onOpenChange) but
// renders Mantine's Collapse underneath.

interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

interface CollapsibleContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CollapsibleContext = React.createContext<CollapsibleContextValue>({
  open: false,
  setOpen: () => {},
});

const Collapsible = ({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  children,
  className,
}: CollapsibleProps) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen! : internalOpen;

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange],
  );

  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div className={className}>{children}</div>
    </CollapsibleContext.Provider>
  );
};
Collapsible.displayName = 'Collapsible';

// ── CollapsibleTrigger ────────────────────────────────────────────────────────

interface CollapsibleTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
  onClick?: React.MouseEventHandler;
}

const CollapsibleTrigger = ({ children, className, onClick }: CollapsibleTriggerProps) => {
  const { open, setOpen } = React.useContext(CollapsibleContext);
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      onClick={e => {
        setOpen(!open);
        onClick?.(e);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') setOpen(!open);
      }}
    >
      {children}
    </div>
  );
};
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

// ── CollapsibleContent ────────────────────────────────────────────────────────

interface CollapsibleContentProps extends Omit<CollapseProps, 'expanded'> {
  children: React.ReactNode;
  className?: string;
}

const CollapsibleContent = ({ children, className, ...props }: CollapsibleContentProps) => {
  const { open } = React.useContext(CollapsibleContext);
  return (
    <Collapse expanded={open} className={className} {...props}>
      {children}
    </Collapse>
  );
};
CollapsibleContent.displayName = 'CollapsibleContent';

export { Collapsible, CollapsibleContent, CollapsibleTrigger };

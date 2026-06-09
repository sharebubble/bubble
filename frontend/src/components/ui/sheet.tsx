import { Drawer as MantineDrawer } from '@mantine/core';
import React from 'react';

// ── Sheet context ─────────────────────────────────────────────────────────────

interface SheetContextValue {
  opened: boolean;
  setOpened: (v: boolean) => void;
}

const SheetContext = React.createContext<SheetContextValue>({
  opened: false,
  setOpened: () => {},
});

// ── Sheet (root) ──────────────────────────────────────────────────────────────

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Sheet = ({ open, onOpenChange, defaultOpen = false, children }: SheetProps) => {
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

  return <SheetContext.Provider value={{ opened, setOpened }}>{children}</SheetContext.Provider>;
};
Sheet.displayName = 'Sheet';

// ── SheetTrigger ──────────────────────────────────────────────────────────────

interface SheetTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

const SheetTrigger = ({ children }: SheetTriggerProps) => {
  const { setOpened } = React.useContext(SheetContext);

  if (!React.isValidElement(children)) {
    return (
      <span onClick={() => setOpened(true)} style={{ cursor: 'pointer' }}>
        {children}
      </span>
    );
  }

  const child = children as React.ReactElement<any>;
  return React.cloneElement(child, {
    onClick: (e: React.MouseEvent) => {
      child.props.onClick?.(e);
      setOpened(true);
    },
  });
};
SheetTrigger.displayName = 'SheetTrigger';

// ── SheetClose ────────────────────────────────────────────────────────────────

const SheetClose = ({ children }: { children: React.ReactNode }) => {
  const { setOpened } = React.useContext(SheetContext);

  if (!React.isValidElement(children)) {
    return (
      <span onClick={() => setOpened(false)} style={{ cursor: 'pointer' }}>
        {children}
      </span>
    );
  }

  const child = children as React.ReactElement<any>;
  return React.cloneElement(child, {
    onClick: (e: React.MouseEvent) => {
      child.props.onClick?.(e);
      setOpened(false);
    },
  });
};
SheetClose.displayName = 'SheetClose';

// ── SheetPortal (no-op) ───────────────────────────────────────────────────────

const SheetPortal = ({ children }: { children: React.ReactNode }) => <>{children}</>;
SheetPortal.displayName = 'SheetPortal';

// ── SheetOverlay (no-op) ──────────────────────────────────────────────────────

const SheetOverlay = () => null;
SheetOverlay.displayName = 'SheetOverlay';

// ── SheetContent ──────────────────────────────────────────────────────────────

type DrawerSide = 'top' | 'right' | 'bottom' | 'left';

interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: DrawerSide;
}

// Map Shadcn side → Mantine Drawer position
const sideMap: Record<DrawerSide, 'top' | 'right' | 'bottom' | 'left'> = {
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
};

// Extract header/footer/other children
const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ side = 'right', className, children, ...props }, ref) => {
    const { opened, setOpened } = React.useContext(SheetContext);

    // Separate SheetHeader, SheetFooter, other content
    let headerContent: React.ReactNode = null;
    let footerContent: React.ReactNode = null;
    const bodyChildren: React.ReactNode[] = [];

    React.Children.forEach(children, child => {
      if (React.isValidElement(child)) {
        const dn = (child.type as any)?.displayName ?? '';
        if (dn === 'SheetHeader') headerContent = child;
        else if (dn === 'SheetFooter') footerContent = child;
        else bodyChildren.push(child);
      } else {
        bodyChildren.push(child);
      }
    });

    return (
      <MantineDrawer
        ref={ref}
        opened={opened}
        onClose={() => setOpened(false)}
        position={sideMap[side]}
        className={className}
        withCloseButton={false}
        padding={0}
        {...(props as any)}
      >
        {headerContent}
        {bodyChildren}
        {footerContent}
      </MantineDrawer>
    );
  },
);
SheetContent.displayName = 'SheetContent';

// ── SheetHeader ───────────────────────────────────────────────────────────────

const SheetHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`flex flex-col space-y-2 text-center sm:text-left ${className ?? ''}`} {...props}>
    {children}
  </div>
);
SheetHeader.displayName = 'SheetHeader';

// ── SheetFooter ───────────────────────────────────────────────────────────────

const SheetFooter = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 ${className ?? ''}`}
    {...props}
  >
    {children}
  </div>
);
SheetFooter.displayName = 'SheetFooter';

// ── SheetTitle ────────────────────────────────────────────────────────────────

const SheetTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h2 ref={ref} className={`text-lg font-semibold text-foreground ${className ?? ''}`} {...props}>
      {children}
    </h2>
  ),
);
SheetTitle.displayName = 'SheetTitle';

// ── SheetDescription ──────────────────────────────────────────────────────────

const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => (
  <p ref={ref} className={`text-sm text-muted-foreground ${className ?? ''}`} {...props}>
    {children}
  </p>
));
SheetDescription.displayName = 'SheetDescription';

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};

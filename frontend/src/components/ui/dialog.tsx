import { Modal, type ModalProps } from '@mantine/core';
import React from 'react';

// ── Dialog context ────────────────────────────────────────────────────────────

interface DialogContextValue {
  opened: boolean;
  setOpened: (v: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue>({
  opened: false,
  setOpened: () => {},
});

// ── Dialog (root) ─────────────────────────────────────────────────────────────

interface DialogRootProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
  modal?: boolean;
}

const Dialog = ({ open, onOpenChange, defaultOpen = false, children }: DialogRootProps) => {
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

  return <DialogContext.Provider value={{ opened, setOpened }}>{children}</DialogContext.Provider>;
};
Dialog.displayName = 'Dialog';

// ── DialogTrigger ─────────────────────────────────────────────────────────────

interface DialogTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
}

const DialogTrigger = ({ children }: DialogTriggerProps) => {
  const { setOpened } = React.useContext(DialogContext);

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
DialogTrigger.displayName = 'DialogTrigger';

// ── DialogClose ───────────────────────────────────────────────────────────────

const DialogClose = ({ children }: { children?: React.ReactNode }) => {
  const { setOpened } = React.useContext(DialogContext);

  if (!children) return null;

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
DialogClose.displayName = 'DialogClose';

// ── DialogPortal (no-op) ──────────────────────────────────────────────────────

const DialogPortal = ({ children }: { children: React.ReactNode }) => <>{children}</>;
DialogPortal.displayName = 'DialogPortal';

// ── DialogOverlay (no-op) ─────────────────────────────────────────────────────

const DialogOverlay = () => null;
DialogOverlay.displayName = 'DialogOverlay';

// ── DialogContent ─────────────────────────────────────────────────────────────

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  onInteractOutside?: (e: Event) => void;
  onPointerDownOutside?: (e?: Event) => void;
  onEscapeKeyDown?: (e?: Event) => void;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  (
    {
      className,
      children,
      onInteractOutside: _oi,
      onPointerDownOutside,
      onEscapeKeyDown,
      ...props
    },
    _ref,
  ) => {
    const { opened, setOpened } = React.useContext(DialogContext);

    const handleClose = () => {
      setOpened(false);
      onPointerDownOutside?.();
      onEscapeKeyDown?.();
    };

    // Separate DialogHeader, DialogFooter, other content
    let title: React.ReactNode = null;
    const bodyChildren: React.ReactNode[] = [];

    React.Children.forEach(children, child => {
      if (React.isValidElement(child)) {
        const dn = (child.type as any)?.displayName ?? '';
        if (dn === 'DialogHeader') {
          // Extract title from header
          React.Children.forEach((child.props as any).children, headerChild => {
            if (React.isValidElement(headerChild)) {
              const hdn = (headerChild.type as any)?.displayName ?? '';
              if (hdn === 'DialogTitle') title = (headerChild.props as any).children;
              else bodyChildren.push(headerChild);
            }
          });
        } else {
          bodyChildren.push(child);
        }
      } else {
        bodyChildren.push(child);
      }
    });

    return (
      <Modal
        opened={opened}
        onClose={handleClose}
        title={title}
        className={className}
        {...(props as Partial<ModalProps>)}
      >
        <div {...{ 'data-dialog-content': true }}>{bodyChildren}</div>
      </Modal>
    );
  },
);
DialogContent.displayName = 'DialogContent';

// ── DialogHeader ──────────────────────────────────────────────────────────────

const DialogHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`flex flex-col space-y-1.5 ${className ?? ''}`} {...props}>
    {children}
  </div>
);
DialogHeader.displayName = 'DialogHeader';

// ── DialogFooter ──────────────────────────────────────────────────────────────

const DialogFooter = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-4 ${className ?? ''}`}
    {...props}
  >
    {children}
  </div>
);
DialogFooter.displayName = 'DialogFooter';

// ── DialogTitle ───────────────────────────────────────────────────────────────

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h2
      ref={ref}
      className={`text-lg font-semibold leading-none tracking-tight ${className ?? ''}`}
      {...props}
    >
      {children}
    </h2>
  ),
);
DialogTitle.displayName = 'DialogTitle';

// ── DialogDescription ─────────────────────────────────────────────────────────

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => (
  <p ref={ref} className={`text-sm text-muted-foreground ${className ?? ''}`} {...props}>
    {children}
  </p>
));
DialogDescription.displayName = 'DialogDescription';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};

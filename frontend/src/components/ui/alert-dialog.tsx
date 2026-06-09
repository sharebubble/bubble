import { Button, Group, Modal, Text, type ModalProps } from '@mantine/core';
import React from 'react';

// ── AlertDialog context ───────────────────────────────────────────────────────

interface AlertDialogContextValue {
  opened: boolean;
  setOpened: (v: boolean) => void;
  title: React.ReactNode;
  setTitle: (v: React.ReactNode) => void;
  description: React.ReactNode;
  setDescription: (v: React.ReactNode) => void;
  cancelLabel: React.ReactNode;
  setCancelLabel: (v: React.ReactNode) => void;
  actionLabel: React.ReactNode;
  setActionLabel: (v: React.ReactNode) => void;
  onAction: (() => void) | null;
  setOnAction: (fn: (() => void) | null) => void;
}

const AlertDialogContext = React.createContext<AlertDialogContextValue>({
  opened: false,
  setOpened: () => {},
  title: null,
  setTitle: () => {},
  description: null,
  setDescription: () => {},
  cancelLabel: 'Cancel',
  setCancelLabel: () => {},
  actionLabel: 'Continue',
  setActionLabel: () => {},
  onAction: null,
  setOnAction: () => {},
});

// ── AlertDialog (root) ────────────────────────────────────────────────────────

interface AlertDialogRootProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const AlertDialog = ({
  open,
  onOpenChange,
  defaultOpen = false,
  children,
}: AlertDialogRootProps) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const opened = isControlled ? open! : internalOpen;

  const [title, setTitle] = React.useState<React.ReactNode>(null);
  const [description, setDescription] = React.useState<React.ReactNode>(null);
  const [cancelLabel, setCancelLabel] = React.useState<React.ReactNode>('Cancel');
  const [actionLabel, setActionLabel] = React.useState<React.ReactNode>('Continue');
  const [onAction, setOnAction] = React.useState<(() => void) | null>(null);

  const setOpened = React.useCallback(
    (v: boolean) => {
      if (!isControlled) setInternalOpen(v);
      onOpenChange?.(v);
    },
    [isControlled, onOpenChange],
  );

  return (
    <AlertDialogContext.Provider
      value={{
        opened,
        setOpened,
        title,
        setTitle,
        description,
        setDescription,
        cancelLabel,
        setCancelLabel,
        actionLabel,
        setActionLabel,
        onAction,
        setOnAction,
      }}
    >
      {children}
    </AlertDialogContext.Provider>
  );
};
AlertDialog.displayName = 'AlertDialog';

// ── AlertDialogTrigger ────────────────────────────────────────────────────────

interface AlertDialogTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

const AlertDialogTrigger = ({ children }: AlertDialogTriggerProps) => {
  const { setOpened } = React.useContext(AlertDialogContext);

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
AlertDialogTrigger.displayName = 'AlertDialogTrigger';

// ── AlertDialogContent ────────────────────────────────────────────────────────

interface AlertDialogContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const AlertDialogContent = ({ children, className }: AlertDialogContentProps) => {
  const {
    opened,
    setOpened,
    title: contextTitle,
    description: contextDescription,
    cancelLabel: contextCancelLabel,
    actionLabel: contextActionLabel,
    onAction: contextOnAction,
  } = React.useContext(AlertDialogContext);

  // Walk children to extract header/footer/title/description
  let localTitle: React.ReactNode = contextTitle;
  let localDescription: React.ReactNode = contextDescription;
  let cancelEl: React.ReactNode = null;
  let actionEl: React.ReactNode = null;

  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    const dn = (child.type as any)?.displayName ?? '';
    if (dn === 'AlertDialogHeader') {
      React.Children.forEach((child.props as any).children, headerChild => {
        if (!React.isValidElement(headerChild)) return;
        const hdn = (headerChild.type as any)?.displayName ?? '';
        if (hdn === 'AlertDialogTitle') localTitle = (headerChild.props as any).children;
        if (hdn === 'AlertDialogDescription')
          localDescription = (headerChild.props as any).children;
      });
    }
    if (dn === 'AlertDialogFooter') {
      React.Children.forEach((child.props as any).children, footerChild => {
        if (!React.isValidElement(footerChild)) return;
        const fdn = (footerChild.type as any)?.displayName ?? '';
        if (fdn === 'AlertDialogCancel') cancelEl = footerChild;
        if (fdn === 'AlertDialogAction') actionEl = footerChild;
      });
    }
  });

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={localTitle}
      centered
      className={className}
    >
      {localDescription && (
        <Text size="sm" c="dimmed" mb="md">
          {localDescription}
        </Text>
      )}
      <Group justify="flex-end" mt="md">
        {cancelEl ?? (
          <Button variant="subtle" color="gray" onClick={() => setOpened(false)}>
            Cancel
          </Button>
        )}
        {actionEl}
      </Group>
    </Modal>
  );
};
AlertDialogContent.displayName = 'AlertDialogContent';

// ── AlertDialogHeader ─────────────────────────────────────────────────────────

const AlertDialogHeader = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`flex flex-col space-y-2 ${className ?? ''}`} {...props}>
    {children}
  </div>
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

// ── AlertDialogFooter ─────────────────────────────────────────────────────────

const AlertDialogFooter = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 ${className ?? ''}`}
    {...props}
  >
    {children}
  </div>
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

// ── AlertDialogTitle ──────────────────────────────────────────────────────────

const AlertDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ children, className, ...props }, ref) => (
  <h2 ref={ref} className={`text-lg font-semibold ${className ?? ''}`} {...props}>
    {children}
  </h2>
));
AlertDialogTitle.displayName = 'AlertDialogTitle';

// ── AlertDialogDescription ────────────────────────────────────────────────────

const AlertDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ children, className, ...props }, ref) => (
  <p ref={ref} className={`text-sm text-muted-foreground ${className ?? ''}`} {...props}>
    {children}
  </p>
));
AlertDialogDescription.displayName = 'AlertDialogDescription';

// ── AlertDialogAction ─────────────────────────────────────────────────────────

const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ children, className, onClick, ...props }, ref) => {
  const { setOpened } = React.useContext(AlertDialogContext);
  return (
    <Button
      ref={ref}
      variant="filled"
      color="brand"
      className={className}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e as any);
        setOpened(false);
      }}
      {...(props as any)}
    >
      {children}
    </Button>
  );
});
AlertDialogAction.displayName = 'AlertDialogAction';

// ── AlertDialogCancel ─────────────────────────────────────────────────────────

const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ children, className, onClick, ...props }, ref) => {
  const { setOpened } = React.useContext(AlertDialogContext);
  return (
    <Button
      ref={ref}
      variant="subtle"
      color="gray"
      className={className}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e as any);
        setOpened(false);
      }}
      {...(props as any)}
    >
      {children}
    </Button>
  );
});
AlertDialogCancel.displayName = 'AlertDialogCancel';

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
};

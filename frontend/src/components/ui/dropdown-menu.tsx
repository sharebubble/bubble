import { Menu, type MenuProps } from '@mantine/core';
import React from 'react';

// ── DropdownMenu (root) ───────────────────────────────────────────────────────

interface DropdownMenuProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
}

const DropdownMenu = ({ children, open, onOpenChange }: DropdownMenuProps) => (
  <Menu opened={open} onChange={onOpenChange} shadow="md" width={200}>
    {children}
  </Menu>
);
DropdownMenu.displayName = 'DropdownMenu';

// ── DropdownMenuTrigger ───────────────────────────────────────────────────────

interface DropdownMenuTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
}

const DropdownMenuTrigger = ({ children, asChild }: DropdownMenuTriggerProps) => {
  if (asChild && React.isValidElement(children)) {
    return <Menu.Target>{children}</Menu.Target>;
  }
  return <Menu.Target>{children}</Menu.Target>;
};
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

// ── DropdownMenuContent ───────────────────────────────────────────────────────

interface DropdownMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
}

const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  ({ className, children, ...props }, ref) => (
    <Menu.Dropdown ref={ref} className={className} {...(props as any)}>
      {children}
    </Menu.Dropdown>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

// ── DropdownMenuItem ──────────────────────────────────────────────────────────

interface DropdownMenuItemProps extends React.HTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  inset?: boolean;
  disabled?: boolean;
}

const DropdownMenuItem = React.forwardRef<HTMLButtonElement, DropdownMenuItemProps>(
  ({ children, asChild, className, onClick, disabled, ...props }, ref) => {
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<any>;
      const childProps = child.props as any;
      return (
        <Menu.Item
          component={child.type as React.ElementType}
          className={className}
          disabled={disabled}
          {...childProps}
        />
      );
    }
    return (
      <Menu.Item
        ref={ref}
        className={className}
        onClick={onClick as any}
        disabled={disabled}
        {...(props as any)}
      >
        {children}
      </Menu.Item>
    );
  },
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

// ── DropdownMenuCheckboxItem ──────────────────────────────────────────────────

interface DropdownMenuCheckboxItemProps extends React.HTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const DropdownMenuCheckboxItem = React.forwardRef<HTMLButtonElement, DropdownMenuCheckboxItemProps>(
  ({ children, checked, onCheckedChange, className, ...props }, ref) => (
    <Menu.Item
      ref={ref}
      className={className}
      onClick={() => onCheckedChange?.(!checked)}
      {...(props as any)}
    >
      {children}
    </Menu.Item>
  ),
);
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

// ── DropdownMenuRadioItem ─────────────────────────────────────────────────────

const DropdownMenuRadioItem = React.forwardRef<
  HTMLButtonElement,
  React.HTMLAttributes<HTMLButtonElement>
>(({ children, className, ...props }, ref) => (
  <Menu.Item ref={ref} className={className} {...(props as any)}>
    {children}
  </Menu.Item>
));
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

// ── DropdownMenuLabel ─────────────────────────────────────────────────────────

const DropdownMenuLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className, ...props }, ref) => (
    <Menu.Label ref={ref} className={className} {...(props as any)}>
      {children}
    </Menu.Label>
  ),
);
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

// ── DropdownMenuSeparator ─────────────────────────────────────────────────────

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <Menu.Divider ref={ref} className={className} {...(props as any)} />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

// ── DropdownMenuShortcut ──────────────────────────────────────────────────────

const DropdownMenuShortcut = ({ children, className }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={`ml-auto text-xs tracking-widest text-muted-foreground ${className ?? ''}`}>
    {children}
  </span>
);
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

// ── Group / Portal / Sub wrappers (no-ops / pass-throughs) ───────────────────

const DropdownMenuGroup = ({ children }: { children: React.ReactNode }) => <>{children}</>;
DropdownMenuGroup.displayName = 'DropdownMenuGroup';

const DropdownMenuPortal = ({ children }: { children: React.ReactNode }) => <>{children}</>;
DropdownMenuPortal.displayName = 'DropdownMenuPortal';

const DropdownMenuSub = ({ children }: { children: React.ReactNode }) => <>{children}</>;
DropdownMenuSub.displayName = 'DropdownMenuSub';

const DropdownMenuSubContent = ({ children }: { children: React.ReactNode }) => <>{children}</>;
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';

const DropdownMenuSubTrigger = ({ children }: { children: React.ReactNode }) => <>{children}</>;
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';

const DropdownMenuRadioGroup = ({ children }: { children: React.ReactNode }) => <>{children}</>;
DropdownMenuRadioGroup.displayName = 'DropdownMenuRadioGroup';

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};

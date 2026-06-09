import { Tabs as MantineTabs, type TabsProps as MantineTabsProps } from '@mantine/core';
import React from 'react';

// ── Tabs ─────────────────────────────────────────────────────────────────────

interface TabsProps extends Omit<MantineTabsProps, 'onChange'> {
  className?: string;
  /** Shadcn-compat alias for Mantine's onChange */
  onValueChange?: (value: string) => void;
  onChange?: (value: string | null) => void;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, onValueChange, onChange, ...props }, ref) => (
    <MantineTabs
      ref={ref}
      className={className}
      onChange={v => {
        onChange?.(v);
        if (v != null) onValueChange?.(v);
      }}
      {...props}
    />
  ),
);
Tabs.displayName = 'Tabs';

// ── TabsList ──────────────────────────────────────────────────────────────────

interface TabsListProps extends React.ComponentPropsWithRef<typeof MantineTabs.List> {
  className?: string;
}

const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(({ className, ...props }, ref) => (
  <MantineTabs.List ref={ref} className={className} {...props} />
));
TabsList.displayName = 'TabsList';

// ── TabsTrigger ───────────────────────────────────────────────────────────────

interface TabsTriggerProps extends React.ComponentPropsWithRef<typeof MantineTabs.Tab> {
  value: string;
  className?: string;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ value, className, children, ...props }, ref) => (
    <MantineTabs.Tab ref={ref} value={value} className={className} {...props}>
      {children}
    </MantineTabs.Tab>
  ),
);
TabsTrigger.displayName = 'TabsTrigger';

// ── TabsContent ───────────────────────────────────────────────────────────────

interface TabsContentProps extends React.ComponentPropsWithRef<typeof MantineTabs.Panel> {
  value: string;
  className?: string;
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ value, className, children, ...props }, ref) => (
    <MantineTabs.Panel ref={ref} value={value} className={className} {...props}>
      {children}
    </MantineTabs.Panel>
  ),
);
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsContent, TabsList, TabsTrigger };

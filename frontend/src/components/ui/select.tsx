import { Select as MantineSelect, type SelectProps as MantineSelectProps } from '@mantine/core';
import React from 'react';

// ── Select ────────────────────────────────────────────────────────────────────
// Shadcn Select uses a compound component pattern (Select + SelectTrigger +
// SelectContent + SelectItem etc.). Mantine uses a single <Select data={...} />.
//
// Strategy: The compound components collect their children and props into a
// context, then the root <Select> renders a Mantine <Select> once all children
// have been processed.
//
// For simple cases the wrapper works transparently. For complex use cases
// (dynamic content, groups, etc.) callers can always import Mantine's Select
// directly.

interface SelectContextValue {
  value?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  items: { value: string; label: string; disabled?: boolean }[];
  addItem: (item: { value: string; label: string; disabled?: boolean }) => void;
  placeholder?: string;
}

const SelectContext = React.createContext<SelectContextValue>({
  items: [],
  addItem: () => {},
});

// ── Root ──────────────────────────────────────────────────────────────────────

interface SelectRootProps {
  value?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
  required?: boolean;
}

const Select = ({
  value,
  onValueChange,
  open,
  onOpenChange,
  children,
  disabled,
  required,
}: SelectRootProps) => {
  const [items, setItems] = React.useState<SelectContextValue['items']>([]);
  const [placeholder, setPlaceholder] = React.useState<string | undefined>();

  const addItem = React.useCallback(
    (item: { value: string; label: string; disabled?: boolean }) => {
      setItems(prev => {
        if (prev.some(i => i.value === item.value)) return prev;
        return [...prev, item];
      });
    },
    [],
  );

  // Collect items from children (SelectItem nodes)
  React.Children.forEach(children, child => {
    if (React.isValidElement(child)) {
      const childProps = child.props as any;
      if ((child.type as any)?.displayName === 'SelectValue' && childProps.placeholder) {
        // capture placeholder asynchronously via a ref instead to avoid setState during render
      }
    }
  });

  return (
    <SelectContext.Provider
      value={{ value, onValueChange, open, onOpenChange, items, addItem, placeholder }}
    >
      <_SelectCollector
        onItems={setItems}
        onPlaceholder={setPlaceholder}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        required={required}
      >
        {children}
      </_SelectCollector>
    </SelectContext.Provider>
  );
};
Select.displayName = 'Select';

// Internal component that collects items and renders the Mantine Select
const _SelectCollector = ({
  children,
  onItems,
  onPlaceholder,
  value,
  onValueChange,
  disabled,
  required,
}: {
  children: React.ReactNode;
  onItems: (items: SelectContextValue['items']) => void;
  onPlaceholder: (p: string) => void;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) => {
  const collected: SelectContextValue['items'] = [];
  let placeholder = '';
  let triggerClassName = '';

  const walkChildren = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, child => {
      if (!React.isValidElement(child)) return;
      const dn = (child.type as any)?.displayName ?? '';
      const cp = child.props as any;

      if (dn === 'SelectItem') {
        collected.push({ value: cp.value, label: cp.children, disabled: cp.disabled });
      } else if (dn === 'SelectValue') {
        placeholder = cp.placeholder ?? '';
      } else if (dn === 'SelectTrigger') {
        triggerClassName = cp.className ?? '';
        walkChildren(cp.children);
      } else if (dn === 'SelectContent' || dn === 'SelectGroup') {
        walkChildren(cp.children);
      }
    });
  };

  walkChildren(children);

  return (
    <MantineSelect
      value={value}
      onChange={v => v && onValueChange?.(v)}
      data={collected}
      placeholder={placeholder || undefined}
      className={triggerClassName}
      disabled={disabled}
      required={required}
    />
  );
};

// ── SelectTrigger ─────────────────────────────────────────────────────────────

interface SelectTriggerProps extends React.HTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  className?: string;
}

const SelectTrigger = ({ className, children }: SelectTriggerProps) => <>{children}</>;
SelectTrigger.displayName = 'SelectTrigger';

// ── SelectValue ───────────────────────────────────────────────────────────────

interface SelectValueProps {
  placeholder?: string;
  children?: React.ReactNode;
}

const SelectValue = ({ placeholder: _p }: SelectValueProps) => null;
SelectValue.displayName = 'SelectValue';

// ── SelectContent ─────────────────────────────────────────────────────────────

const SelectContent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
SelectContent.displayName = 'SelectContent';

// ── SelectGroup ───────────────────────────────────────────────────────────────

const SelectGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
SelectGroup.displayName = 'SelectGroup';

// ── SelectLabel ───────────────────────────────────────────────────────────────

const SelectLabel = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
SelectLabel.displayName = 'SelectLabel';

// ── SelectItem ────────────────────────────────────────────────────────────────

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

const SelectItem = ({ children: _c }: SelectItemProps) => null;
SelectItem.displayName = 'SelectItem';

// ── SelectSeparator ───────────────────────────────────────────────────────────

const SelectSeparator = () => null;
SelectSeparator.displayName = 'SelectSeparator';

// ── Scroll Buttons (no-ops) ───────────────────────────────────────────────────

const SelectScrollUpButton = () => null;
SelectScrollUpButton.displayName = 'SelectScrollUpButton';
const SelectScrollDownButton = () => null;
SelectScrollDownButton.displayName = 'SelectScrollDownButton';

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};

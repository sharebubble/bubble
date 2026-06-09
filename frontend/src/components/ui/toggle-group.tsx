import { SegmentedControl, type SegmentedControlProps } from '@mantine/core';
import React from 'react';

// ── ToggleGroup ───────────────────────────────────────────────────────────────
// Wraps Mantine's SegmentedControl to match Shadcn's ToggleGroup API.
// Children are expected to be <ToggleGroupItem value="..."> elements.

interface ToggleGroupProps {
  type: 'single' | 'multiple';
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const ToggleGroup = ({
  value,
  onValueChange,
  children,
  className,
  size = 'sm',
}: ToggleGroupProps) => {
  // Collect data from ToggleGroupItem children
  const data: { value: string; label: React.ReactNode }[] = [];

  React.Children.forEach(children, child => {
    if (React.isValidElement(child)) {
      const dn = (child.type as any)?.displayName ?? '';
      if (dn === 'ToggleGroupItem') {
        const cp = child.props as { value: string; children?: React.ReactNode };
        data.push({ value: cp.value, label: cp.children ?? cp.value });
      }
    }
  });

  return (
    <SegmentedControl
      value={value}
      onChange={onValueChange}
      data={data.map(d => ({ value: d.value, label: d.label as string }))}
      className={className}
      size={size}
    />
  );
};
ToggleGroup.displayName = 'ToggleGroup';

// ── ToggleGroupItem ───────────────────────────────────────────────────────────
// Only used to collect value+label for ToggleGroup above.

interface ToggleGroupItemProps {
  value: string;
  children?: React.ReactNode;
  className?: string;
  'aria-label'?: string;
  disabled?: boolean;
}

const ToggleGroupItem = ({ children }: ToggleGroupItemProps) => <>{children}</>;
ToggleGroupItem.displayName = 'ToggleGroupItem';

export { ToggleGroup, ToggleGroupItem };

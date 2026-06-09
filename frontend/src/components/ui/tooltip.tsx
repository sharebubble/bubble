import { Tooltip as MantineTooltip, type TooltipProps as MantineTooltipProps } from '@mantine/core';
import React from 'react';

// ── TooltipProvider ──────────────────────────────────────────────────────────
// Mantine doesn't need a provider wrapper — this is a no-op shim for
// backward-compat with code that wraps Shadcn tooltips in <TooltipProvider>.

const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;
TooltipProvider.displayName = 'TooltipProvider';

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipProps {
  children: React.ReactNode;
  className?: string;
}

const Tooltip = ({ children }: TooltipProps) => <>{children}</>;
Tooltip.displayName = 'Tooltip';

// ── TooltipTrigger ───────────────────────────────────────────────────────────
// Holds the reference element. Mantine wraps the child directly.

interface TooltipTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

const TooltipTrigger = React.forwardRef<HTMLElement, TooltipTriggerProps>(({ children }, _ref) => (
  <>{children}</>
));
TooltipTrigger.displayName = 'TooltipTrigger';

// ── TooltipContent ───────────────────────────────────────────────────────────
// The actual tooltip label. We reconstruct the Mantine Tooltip here wrapping
// the sibling trigger by using a compound component pattern via context.

interface TooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  sideOffset?: number;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  ({ children }, _ref) => <>{children}</>,
);
TooltipContent.displayName = 'TooltipContent';

// ── Compound Tooltip ─────────────────────────────────────────────────────────
// The real Mantine Tooltip wraps the trigger+content pattern by scanning
// children for TooltipTrigger and TooltipContent.
// Usage:
//   <Tooltip>
//     <TooltipTrigger asChild><Button>hover me</Button></TooltipTrigger>
//     <TooltipContent>label text</TooltipContent>
//   </Tooltip>

interface CompoundTooltipProps extends Omit<MantineTooltipProps, 'label' | 'children'> {
  children: React.ReactNode;
}

const CompoundTooltip = ({ children, ...restProps }: CompoundTooltipProps) => {
  let props = restProps;
  let trigger: React.ReactNode = null;
  let label: React.ReactNode = null;

  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    const displayName = (child.type as any)?.displayName ?? (child.type as any)?.name ?? '';
    if (displayName === 'TooltipTrigger') {
      // Unwrap asChild — render child's children
      const triggerProps = child.props as TooltipTriggerProps;
      trigger = triggerProps.children;
    } else if (displayName === 'TooltipContent') {
      label = (child.props as React.HTMLAttributes<HTMLDivElement>).children;
      const cp = child.props as TooltipContentProps;
      if (cp.side && !props.position) {
        props = { ...props, position: cp.side };
      }
    }
  });

  if (!label) return <>{trigger}</>;

  return (
    <MantineTooltip label={label} {...props}>
      <span style={{ display: 'inline-flex' }}>{trigger}</span>
    </MantineTooltip>
  );
};
CompoundTooltip.displayName = 'Tooltip';

export { CompoundTooltip as Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };

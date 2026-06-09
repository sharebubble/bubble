import { Table as MantineTable, type TableProps as MantineTableProps } from '@mantine/core';
import React from 'react';

// ── Table ─────────────────────────────────────────────────────────────────────

interface TableProps extends MantineTableProps {
  className?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, children, ...props }, ref) => (
    <MantineTable ref={ref} withTableBorder withColumnBorders className={className} {...props}>
      {children}
    </MantineTable>
  ),
);
Table.displayName = 'Table';

// ── TableHeader ───────────────────────────────────────────────────────────────

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => (
  <MantineTable.Thead ref={ref} className={className} {...props}>
    {children}
  </MantineTable.Thead>
));
TableHeader.displayName = 'TableHeader';

// ── TableBody ─────────────────────────────────────────────────────────────────

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => (
  <MantineTable.Tbody ref={ref} className={className} {...props}>
    {children}
  </MantineTable.Tbody>
));
TableBody.displayName = 'TableBody';

// ── TableFooter ───────────────────────────────────────────────────────────────

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => (
  <MantineTable.Tfoot ref={ref} className={className} {...props}>
    {children}
  </MantineTable.Tfoot>
));
TableFooter.displayName = 'TableFooter';

// ── TableRow ──────────────────────────────────────────────────────────────────

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, children, ...props }, ref) => (
    <MantineTable.Tr ref={ref} className={className} {...props}>
      {children}
    </MantineTable.Tr>
  ),
);
TableRow.displayName = 'TableRow';

// ── TableHead ─────────────────────────────────────────────────────────────────

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, children, ...props }, ref) => (
  <MantineTable.Th ref={ref} className={className} {...props}>
    {children}
  </MantineTable.Th>
));
TableHead.displayName = 'TableHead';

// ── TableCell ─────────────────────────────────────────────────────────────────

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, children, ...props }, ref) => (
  <MantineTable.Td ref={ref} className={className} {...props}>
    {children}
  </MantineTable.Td>
));
TableCell.displayName = 'TableCell';

// ── TableCaption ──────────────────────────────────────────────────────────────

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, children, ...props }, ref) => (
  <caption ref={ref} className={`mt-4 text-sm text-muted-foreground ${className ?? ''}`} {...props}>
    {children}
  </caption>
));
TableCaption.displayName = 'TableCaption';

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };

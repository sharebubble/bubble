import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoney } from '@/lib/currency';
import { type SeriesSlot, useChartColors } from '@/hooks/useChartColors';
import { Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';

export interface Series {
  slot: SeriesSlot;
  label: string;
}

/** Always shown for two or more series, so identity never rests on colour alone. */
export const SeriesLegend = ({ series }: { series: Series[] }) => {
  const colors = useChartColors();
  return (
    <Group gap="md" aria-hidden="true">
      {series.map(item => (
        <Group key={item.slot} gap={6} wrap="nowrap">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: colors[item.slot] }}
          />
          <Text size="xs" c="dimmed">
            {item.label}
          </Text>
        </Group>
      ))}
    </Group>
  );
};

export interface BarValue {
  slot: SeriesSlot;
  label: string;
  value: number;
}

export interface BarRow {
  key: string;
  label: ReactNode;
  /** One to three values, drawn as thin bars under each other. */
  values: BarValue[];
  /** Extra line under the bars (e.g. budget progress). */
  footer?: ReactNode;
  hint?: string;
  onClick?: () => void;
}

/**
 * A ranked list of horizontal bars on one shared scale. Every bar carries its
 * amount as text next to it, and a tooltip with the details on hover.
 */
export const BarList = ({ rows, currency }: { rows: BarRow[]; currency: string }) => {
  const { language } = useLanguage();
  const colors = useChartColors();
  const max = Math.max(1, ...rows.flatMap(row => row.values.map(v => Math.abs(v.value))));
  const money = (value: number) => formatMoney(value, currency, language);

  return (
    <Stack gap="sm">
      {rows.map(row => {
        const tooltip = (
          <Stack gap={2}>
            {row.values.map(v => (
              <Text key={v.slot} size="xs">
                {v.label}: {money(v.value)}
              </Text>
            ))}
            {row.hint && <Text size="xs">{row.hint}</Text>}
          </Stack>
        );
        return (
          <Tooltip key={row.key} label={tooltip} position="top-start" openDelay={100}>
            <div
              className={row.onClick ? 'cursor-pointer' : undefined}
              onClick={row.onClick}
              role={row.onClick ? 'button' : undefined}
              tabIndex={row.onClick ? 0 : undefined}
              onKeyDown={event => {
                if (row.onClick && (event.key === 'Enter' || event.key === ' ')) row.onClick();
              }}
            >
              <Text size="sm" fw={500} truncate>
                {row.label}
              </Text>
              {row.values.map(v => (
                <Group key={v.slot} gap="xs" wrap="nowrap" className="mt-1">
                  <div className="h-2 min-w-0 flex-1">
                    <div
                      className="h-2 rounded-r"
                      style={{
                        width: `${(Math.abs(v.value) / max) * 100}%`,
                        minWidth: v.value ? 2 : 0,
                        background: colors[v.slot],
                      }}
                    />
                  </div>
                  <Text size="xs" c="dimmed" className="w-24 shrink-0 text-right tabular-nums">
                    {money(v.value)}
                  </Text>
                </Group>
              ))}
              {row.footer}
            </div>
          </Tooltip>
        );
      })}
    </Stack>
  );
};

export interface MonthPoint {
  key: string;
  label: string;
  /** Axis label, e.g. "Feb" or "Jan 26". */
  short: string;
  first: number;
  second: number;
}

const CHART_HEIGHT = 160;

/**
 * Paired columns per month on one axis (never two scales), with a hover
 * tooltip per month and the same numbers as a table underneath.
 */
export const MonthColumns = ({
  points,
  series,
  currency,
}: {
  points: MonthPoint[];
  series: [Series, Series];
  currency: string;
}) => {
  const { language } = useLanguage();
  const colors = useChartColors();
  const max = Math.max(1, ...points.flatMap(p => [Math.abs(p.first), Math.abs(p.second)]));
  const money = (value: number) => formatMoney(value, currency, language);
  const height = (value: number) => Math.max(value ? 2 : 0, (Math.abs(value) / max) * CHART_HEIGHT);

  return (
    <Stack gap="sm">
      <SeriesLegend series={series} />
      <div className="overflow-x-auto">
        <div
          className="flex items-end gap-3 border-b border-[var(--mantine-color-default-border)] px-1"
          style={{ height: CHART_HEIGHT + 4, minWidth: points.length * 44 }}
        >
          {points.map(point => (
            <Tooltip
              key={point.key}
              label={
                <Stack gap={2}>
                  <Text size="xs" fw={600}>
                    {point.label}
                  </Text>
                  <Text size="xs">
                    {series[0].label}: {money(point.first)}
                  </Text>
                  <Text size="xs">
                    {series[1].label}: {money(point.second)}
                  </Text>
                </Stack>
              }
            >
              <div className="flex h-full min-w-8 flex-1 items-end justify-center gap-0.5">
                <div
                  className="w-3 rounded-t"
                  style={{ height: height(point.first), background: colors[series[0].slot] }}
                />
                <div
                  className="w-3 rounded-t"
                  style={{ height: height(point.second), background: colors[series[1].slot] }}
                />
              </div>
            </Tooltip>
          ))}
        </div>
        <div className="flex gap-3 px-1 pt-1" style={{ minWidth: points.length * 44 }}>
          {points.map(point => (
            <Text key={point.key} size="xs" c="dimmed" className="min-w-8 flex-1 text-center">
              {point.short}
            </Text>
          ))}
        </div>
      </div>
      <Table striped withTableBorder fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            <Table.Th className="text-right">{series[0].label}</Table.Th>
            <Table.Th className="text-right">{series[1].label}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {points.map(point => (
            <Table.Tr key={point.key}>
              <Table.Td>{point.label}</Table.Td>
              <Table.Td className="text-right tabular-nums">{money(point.first)}</Table.Td>
              <Table.Td className="text-right tabular-nums">{money(point.second)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
};

import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
import {
  getSalesTypeBadgeProps,
  getStatusLabel,
  getStatusMantineColor,
} from '@/components/items/status';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { formatPrice, getRentalPeriodSuffixKey } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { type ItemList, type SalesTypeEnum, type Status7D3Enum } from '@/services/django';
import { Badge, Table, Text } from '@mantine/core';
import { useNavigate } from 'react-router-dom';

type ListViewProps = {
  items: ItemList[];
};

export const ListView = ({ items }: ListViewProps) => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  return (
    <div className="rounded-lg border">
      <Table.ScrollContainer minWidth={720} type="native">
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className="w-16"></Table.Th>
              <Table.Th>{t('item.name')}</Table.Th>
              <Table.Th>{t('item.category')}</Table.Th>
              <Table.Th>{t('item.salesType.label')}</Table.Th>
              <Table.Th>{t('item.condition')}</Table.Th>
              <Table.Th>{t('item.price')}</Table.Th>
              <Table.Th>{t('item.createdAt')}</Table.Th>
              <Table.Th className="w-10"></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map(item => (
              <Table.Tr
                key={item.id}
                className="cursor-pointer"
                onClick={() => navigate(`/item/${item.id}`)}
              >
                <Table.Td>
                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0">
                    {item.first_image ? (
                      <img
                        src={item.first_image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (() => {
                        const CategoryIcon = getCategoryIcon(item.category);
                        return (
                          <div className="flex h-full w-full items-center justify-center bg-muted">
                            <CategoryIcon className="h-5 w-5 text-muted-foreground/50" />
                          </div>
                        );
                      })()
                    )}
                  </div>
                </Table.Td>
                <Table.Td>
                  <div className="font-medium max-w-56 truncate">{item.name}</div>
                  {item.description && (
                    <Text size="xs" c="dimmed" truncate className="max-w-56">
                      {item.description}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge variant="outline" color="gray" size="sm">
                    {t(`categories.${item.category}`)}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {item.sales_type && (
                    <Badge
                      {...getSalesTypeBadgeProps(item.sales_type as SalesTypeEnum)}
                      size="sm"
                    >
                      {t(`item.salesType.badge.${item.sales_type}`)}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  {typeof item.status !== 'undefined' && item.status !== null && (
                    <Badge
                      color={getStatusMantineColor(item.status as Status7D3Enum)}
                      size="sm"
                    >
                      {getStatusLabel(item.status as Status7D3Enum)
                        ? t(`status.${getStatusLabel(item.status as Status7D3Enum)}`)
                        : ''}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500} className="whitespace-nowrap">
                    {item.price
                      ? `${formatPrice(item.price, item.price_currency)}${
                          item.sales_type === 'rent'
                            ? ` ${t(getRentalPeriodSuffixKey(item.rental_period))}`
                            : ''
                        }`
                      : '—'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed" className="whitespace-nowrap">
                    {formatDate(item.created_at, language)}
                  </Text>
                </Table.Td>
                <Table.Td onClick={e => e.stopPropagation()}>
                  <AddToCollectionPopover itemId={item.id} iconOnly />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
};

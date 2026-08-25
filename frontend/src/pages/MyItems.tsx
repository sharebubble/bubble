import { BackButton } from '@/components/layout/BackButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeleteItem, useMyItems, useUpdateItemStatus } from '@/hooks/useMyItems';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { convertLineBreaks } from '@/lib/convertLineBreaks';
import { formatPrice, getRentalPeriodSuffixKey } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import {
  ACTIVE_STATUSES,
  ARCHIVED_STATUSES,
  getSalesTypeBadgeProps,
  getStatusMantineColor,
} from '@/components/items/status';
import { SalesTypeEnum, Status7D3Enum } from '@/services/django';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Menu,
  Select,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { Archive, Edit3, Eye, Grid3X3, List, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

type ItemsTab = 'active' | 'archived';

const MyItems = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  // Tab and view mode live in the URL (rather than local/localStorage state)
  // so the current view survives a refresh and a shared link reproduces what
  // was shared.
  const [searchParams, setSearchParams] = useSearchParams();
  // Sold and archived items live in their own tab so the default view stays
  // focused on the items still in circulation.
  const tab: ItemsTab = searchParams.get('tab') === 'archived' ? 'archived' : 'active';
  const setTab = (value: ItemsTab) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === 'active') next.delete('tab');
      else next.set('tab', value);
      return next;
    });
  };
  const viewMode: 'list' | 'cards' = searchParams.get('view') === 'cards' ? 'cards' : 'list';
  const toggleViewMode = (mode: 'list' | 'cards') => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (mode === 'list') next.delete('view');
        else next.set('view', mode);
        return next;
      },
      { replace: true },
    );
  };

  const { data: myItemsData, isLoading } = useMyItems(
    undefined,
    tab === 'archived' ? ARCHIVED_STATUSES : ACTIVE_STATUSES,
  );
  const items = myItemsData?.results || [];
  const updateStatusMutation = useUpdateItemStatus();
  const deleteItemMutation = useDeleteItem();

  // Helper function to get the correct edit URL based on item category
  const getEditUrl = (item: any) => {
    return item.category === 'books' ? `/edit-book/${item.id}` : `/edit-item/${item.id}`;
  };

  // Cap the description preview so it doesn't dominate the list view.
  const MAX_DESCRIPTION_PREVIEW = 100;
  const truncateDescription = (text: string) =>
    text.length > MAX_DESCRIPTION_PREVIEW
      ? `${text.slice(0, MAX_DESCRIPTION_PREVIEW).trimEnd()}…`
      : text;

  const handleDeleteItem = (itemId: string) => {
    deleteItemMutation.mutate(itemId);
  };

  const openDeleteConfirm = (itemId: string) => {
    modals.openConfirmModal({
      title: 'Are you absolutely sure?',
      children: (
        <Text size="sm">
          This action cannot be undone. This will permanently delete your item and remove its data
          from our servers.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => handleDeleteItem(itemId),
    });
  };

  const handleStatusChange = async (
    itemId: string,
    newStatus: 'draft' | 'available' | 'reserved' | 'rented' | 'sold' | 'archived',
  ) => {
    // Map string status to Status7D3Enum number
    let statusEnum: Status7D3Enum;
    switch (newStatus) {
      case 'draft':
        statusEnum = 0;
        break;
      case 'available':
        statusEnum = 2;
        break;
      case 'reserved':
        statusEnum = 3;
        break;
      case 'rented':
        statusEnum = 4;
        break;
      case 'sold':
        statusEnum = 5;
        break;
      case 'archived':
        statusEnum = 6;
        break;
      default:
        statusEnum = 0;
    }

    updateStatusMutation.mutate({ itemId, status: statusEnum });
  };

  const handleStatusSelectChange = (itemId: string, value: string | null) => {
    if (!value) return;
    const statusMap: Record<
      string,
      'draft' | 'available' | 'reserved' | 'rented' | 'sold' | 'archived'
    > = {
      '0': 'draft',
      '2': 'available',
      '3': 'reserved',
      '4': 'rented',
      '5': 'sold',
      '6': 'archived',
    };
    handleStatusChange(itemId, statusMap[value] || 'draft');
  };

  /** Returns the Select options appropriate for the given sales_type. */
  const getStatusOptions = (salesType: SalesTypeEnum | undefined) => {
    const sellDonate = ['sell', 'donate', 'want_buy'];
    const rentBorrow = ['rent', 'borrow', 'want_rent'];
    if (salesType && sellDonate.includes(salesType)) {
      return [
        { value: '0', label: t('status.draft') },
        { value: '2', label: t('status.available') },
        { value: '3', label: t('status.reserved') },
        { value: '5', label: t('status.sold') },
        { value: '6', label: t('status.archived') },
      ];
    }
    if (salesType && rentBorrow.includes(salesType)) {
      return [
        { value: '0', label: t('status.draft') },
        { value: '2', label: t('status.available') },
        { value: '4', label: t('status.rented') },
        { value: '6', label: t('status.archived') },
      ];
    }
    // fallback: all options
    return [
      { value: '0', label: t('status.draft') },
      { value: '2', label: t('status.available') },
      { value: '3', label: t('status.reserved') },
      { value: '4', label: t('status.rented') },
      { value: '5', label: t('status.sold') },
      { value: '6', label: t('status.archived') },
    ];
  };

  const getStatusText = (status: Status7D3Enum | undefined) => {
    switch (status) {
      case 0:
        return t('status.draft');
      case 2:
        return t('status.available');
      case 3:
        return t('status.reserved');
      case 4:
        return t('status.rented');
      case 5:
        return t('status.sold');
      case 6:
        return t('status.archived');
      default:
        return t('status.unknown');
    }
  };

  const renderItemMenu = (item: (typeof items)[number]) => (
    <Menu position="bottom-end" shadow="md">
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Actions">
          <MoreHorizontal size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<Eye size={16} />} onClick={() => navigate(`/item/${item.id}`)}>
          View
        </Menu.Item>
        <Menu.Item leftSection={<Edit3 size={16} />} onClick={() => navigate(getEditUrl(item))}>
          Edit
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<Trash2 size={16} />}
          onClick={() => openDeleteConfirm(item.id)}
        >
          Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <BackButton />
          <Title order={1} size="h3">
            {t('myItems.title')}
          </Title>
        </div>
        <div className="flex items-center gap-4">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <ActionIcon
              variant={viewMode === 'list' ? 'filled' : 'subtle'}
              color={viewMode === 'list' ? undefined : 'gray'}
              size="lg"
              onClick={() => toggleViewMode('list')}
              aria-label="List view"
            >
              <List size={16} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === 'cards' ? 'filled' : 'subtle'}
              color={viewMode === 'cards' ? undefined : 'gray'}
              size="lg"
              onClick={() => toggleViewMode('cards')}
              aria-label="Card view"
            >
              <Grid3X3 size={16} />
            </ActionIcon>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={value => setTab((value as ItemsTab) ?? 'active')}
        className="mb-6"
      >
        <Tabs.List>
          <Tabs.Tab value="active">{t('myItems.tabs.active')}</Tabs.Tab>
          <Tabs.Tab value="archived" leftSection={<Archive size={16} />}>
            {t('myItems.tabs.archived')}
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {isLoading ? (
        <div className="text-center py-12">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <div className="max-w-md mx-auto">
            <Title order={3} className="mb-2">
              {tab === 'archived' ? t('myItems.noArchivedItems') : t('myItems.noItems')}
            </Title>
            <Text c="dimmed" className="mb-6">
              {tab === 'archived' ? t('myItems.archivedHint') : t('myItems.createFirst')}
            </Text>
            {tab === 'active' && (
              <Button leftSection={<Plus size={16} />} onClick={() => navigate('/create-item')}>
                {t('myItems.shareItem')}
              </Button>
            )}
          </div>
        </div>
      ) : viewMode === 'list' ? (
        <div className="rounded-lg border overflow-hidden">
          <Table.ScrollContainer minWidth={760} type="native">
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="w-20">Image</Table.Th>
                  <Table.Th>Title</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>Price</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th className="w-20">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map(item => {
                  const primaryImage = item.first_image;

                  return (
                    <Table.Tr
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => navigate(getEditUrl(item))}
                    >
                      <Table.Td>
                        <div className="w-12 h-12 rounded-lg overflow-hidden">
                          {primaryImage ? (
                            <img
                              src={primaryImage}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (() => {
                              const CategoryIcon = getCategoryIcon(item.category);
                              return (
                                <div className="flex h-full w-full items-center justify-center bg-gradient-subtle">
                                  <CategoryIcon className="h-6 w-6 text-muted-foreground/50" />
                                </div>
                              );
                            })()
                          )}
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <div className="font-medium max-w-48 truncate">{item.name}</div>
                        {item.description && (
                          <Text size="sm" c="dimmed" className="line-clamp-2 max-w-md">
                            {truncateDescription(item.description)}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td onClick={e => e.stopPropagation()}>
                        <Select
                          className="w-32"
                          value={item.status !== undefined ? item.status.toString() : null}
                          data={getStatusOptions(item.sales_type as SalesTypeEnum | undefined)}
                          onChange={value => handleStatusSelectChange(item.id, value)}
                          disabled={updateStatusMutation.isPending}
                          allowDeselect={false}
                        />
                      </Table.Td>
                      <Table.Td>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" color="gray" size="sm">
                            {t(`categories.${item.category}`)}
                          </Badge>
                          {item.sales_type && (
                            <Badge
                              size="sm"
                              {...getSalesTypeBadgeProps(item.sales_type as SalesTypeEnum)}
                            >
                              {t(`item.salesType.badge.${item.sales_type}`)}
                            </Badge>
                          )}
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <div className="text-sm font-medium">
                          {item.price && (
                            <div className="flex items-center gap-1">
                              {formatPrice(item.price, item.price_currency)}
                              {item.sales_type === 'rent' && (
                                <Text component="span" size="xs" c="dimmed">
                                  {t(getRentalPeriodSuffixKey(item.rental_period))}
                                </Text>
                              )}
                            </div>
                          )}
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {formatDate(item.created_at, language)}
                        </Text>
                      </Table.Td>
                      <Table.Td onClick={e => e.stopPropagation()}>{renderItemMenu(item)}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(item => {
            return (
              <Card key={item.id} withBorder padding="lg" className="overflow-hidden">
                {/* Image */}
                <Card.Section>
                  <div
                    className="aspect-4/3 overflow-hidden cursor-pointer"
                    onClick={() => navigate(getEditUrl(item))}
                  >
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
                          <div className="flex h-full w-full items-center justify-center bg-gradient-subtle">
                            <CategoryIcon className="h-16 w-16 text-muted-foreground/50" />
                          </div>
                        );
                      })()
                    )}
                  </div>
                </Card.Section>

                <div className="pt-4 pb-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Title
                      order={3}
                      size="h5"
                      className="line-clamp-1 cursor-pointer hover:underline"
                      onClick={() => navigate(getEditUrl(item))}
                    >
                      {item.name}
                    </Title>
                    {renderItemMenu(item)}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge size="sm" color={getStatusMantineColor(item.status) ?? 'gray'}>
                      {getStatusText(item.status)}
                    </Badge>
                    <Badge variant="outline" color="gray" size="sm">
                      {t(`categories.${item.category}`)}
                    </Badge>
                  </div>
                </div>

                <div className="pb-3">
                  <Text size="sm" c="dimmed" className="line-clamp-2 mb-3">
                    {item.description !== undefined && convertLineBreaks(item.description)}
                  </Text>

                  {/* Price */}
                  <Text component="div" size="sm" fw={600} c="green.7">
                    {item.price && (
                      <div className="flex items-center gap-1">
                        {formatPrice(item.price, item.price_currency)}
                        {item.sales_type === 'rent' && (
                          <Text component="span" size="xs" fw={400} c="dimmed">
                            {t(getRentalPeriodSuffixKey(item.rental_period))}
                          </Text>
                        )}
                      </div>
                    )}
                  </Text>
                  {item.sales_type && (
                    <Badge
                      size="sm"
                      className="mt-1"
                      {...getSalesTypeBadgeProps(item.sales_type as SalesTypeEnum)}
                    >
                      {t(`item.salesType.badge.${item.sales_type}`)}
                    </Badge>
                  )}
                </div>

                <div className="w-full space-y-2">
                  <Text size="xs" c="dimmed">
                    {t('myItems.status')}
                  </Text>
                  <Select
                    className="w-full"
                    value={item.status !== undefined ? item.status.toString() : null}
                    data={getStatusOptions(item.sales_type as SalesTypeEnum | undefined)}
                    onChange={value => handleStatusSelectChange(item.id, value)}
                    disabled={updateStatusMutation.isPending}
                    allowDeselect={false}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyItems;

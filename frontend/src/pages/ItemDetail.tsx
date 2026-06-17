import { BookingDialog } from '@/components/items/BookingDialog';
import { ItemImageCarousel } from '@/components/items/ItemImageCarousel';
import { RentalCalendar } from '@/components/items/RentalCalendar';
import {
  getSalesTypeBadgeProps,
  getStatusLabel,
  getStatusMantineColor,
} from '@/components/items/status';
import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
import UserInfoBox from '@/components/users/UserInfoBox';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useItem } from '@/hooks/useItem';
import { useDeleteItem } from '@/hooks/useMyItems';
import { useItemCollections } from '@/hooks/useCollections';
import { convertLineBreaks } from '@/lib/convertLineBreaks';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { ActionIcon, Badge, Button, Text, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, BookMarked, Calendar, Edit3, Trash2, Zap } from 'lucide-react';
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

const ItemDetail = () => {
  const { itemUuid } = useParams<{ itemUuid: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { data: item, isLoading, error } = useItem(itemUuid);
  const deleteItemMutation = useDeleteItem();
  const { data: itemCollections } = useItemCollections(user ? itemUuid : undefined);

  const [selectedStartDate, setSelectedStartDate] = useState<Date | undefined>();
  const [selectedEndDate, setSelectedEndDate] = useState<Date | undefined>();
  const [showBookingDialog, setShowBookingDialog] = useState(false);

  const location = useLocation();
  const rentalCalendarRef = useRef<HTMLDivElement | null>(null);

  const isOwner = useMemo(() => {
    if (!user || !item) return false;
    return item.user === user.id;
  }, [user, item]);

  const handleDateRangeSelect = (start: Date, end: Date) => {
    setSelectedStartDate(start);
    setSelectedEndDate(end);
  };

  const handleBookNowFromCalendar = (start: Date, end: Date) => {
    setSelectedStartDate(start);
    setSelectedEndDate(end);
    setShowBookingDialog(true);
  };

  // If the URL contains #booking, scroll to the booking calendar and reveal it.
  useEffect(() => {
    if (location.hash === '#booking' && rentalCalendarRef.current) {
      rentalCalendarRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [location.hash, location.pathname, location.search]);

  const handleDelete = async () => {
    if (!item) return;
    await deleteItemMutation.mutateAsync(item.id, {
      onSuccess: () => navigate('/my-items'),
    });
  };

  const openDeleteConfirm = () =>
    modals.openConfirmModal({
      title: t('itemDetail.deleteConfirmTitle'),
      children: <Text size="sm">{t('itemDetail.deleteConfirmDescription')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => void handleDelete(),
    });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center text-[var(--mantine-color-dimmed)]">
        {t('common.loading')}
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <Text c={error ? 'red' : undefined}>
          {error ? error.message : t('itemDetail.notFound')}
        </Text>
        <Button component={Link} to="/" mt="md" variant="light">
          {t('common.back')}
        </Button>
      </div>
    );
  }

  const {
    name,
    description,
    category,
    condition,
    sales_type,
    price,
    price_currency,
    created_at,
    images,
  } = item;

  const isRental = sales_type === 'rent' || sales_type === 'borrow';
  const isWanted = sales_type === 'want_buy' || sales_type === 'want_rent';
  const hasImages = images.length > 0;

  const conditionMap: Record<number, string> = {
    0: t('condition.new'),
    1: t('condition.used'),
    2: t('condition.broken'),
  };
  const conditionLabel =
    (condition !== undefined ? conditionMap[condition] : undefined) ?? t('condition.unknown');

  const properties = Object.entries(
    (item.properties && typeof item.properties === 'object' && !Array.isArray(item.properties)
      ? item.properties
      : {}) as Record<string, unknown>,
  )
    .filter(([key]) => key !== 'metadata')
    .sort(([a], [b]) => a.localeCompare(b));

  // Booking action: label + whether it is disabled for the current viewer.
  const actionLabel = (() => {
    switch (sales_type) {
      case 'rent':
        return t('itemDetail.rentNow');
      case 'borrow':
        return t('itemDetail.borrowNow');
      case 'donate':
        return t('itemDetail.requestDonate');
      case 'want_buy':
      case 'want_rent':
        return t('itemDetail.contactOwner');
      default:
        return t('itemDetail.buyNow');
    }
  })();

  const buyingAllowed = item.status === 2 || item.status === 3; // 2 = available, 3 = reserved
  const bookingDisabled =
    !user ||
    (isWanted
      ? false
      : (isOwner && !!price && !isRental) || (!buyingAllowed && !!price && !isRental));
  const showBookingAction = !isOwner || isRental || isWanted;

  const formatPropertyValue = (value: unknown) => {
    if (value === null || value === undefined) return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const bookingDialog = (
    <BookingDialog
      itemUuid={item.id}
      itemName={name}
      price={price}
      priceCurrency={price_currency || undefined}
      salesType={sales_type}
      rentalOpenEnd={item.rental_open_end ?? false}
      preselectedStartDate={selectedStartDate}
      preselectedEndDate={selectedEndDate}
      controlledOpen={showBookingDialog}
      onControlledOpenChange={setShowBookingDialog}
      triggerLabel={actionLabel}
      disabled={bookingDisabled}
    />
  );

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <Button
        variant="subtle"
        onClick={() => navigate(-1)}
        mb="lg"
        leftSection={<ArrowLeft size={16} />}
      >
        {t('common.back')}
      </Button>

      <div className={cn('grid gap-8', hasImages ? 'md:grid-cols-2' : 'grid-cols-1')}>
        {hasImages && <ItemImageCarousel images={images} itemName={name} />}

        {/* Item details */}
        <div className="flex flex-col gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge leftSection={createElement(getCategoryIcon(category), { size: 14 })}>
                {t(`categories.${category}`)}
              </Badge>
              <Badge variant="light" color="gray">
                {conditionLabel}
              </Badge>
              {item.status !== undefined && item.status !== null && (
                <Badge color={getStatusMantineColor(item.status)}>
                  {getStatusLabel(item.status) ? t(`status.${getStatusLabel(item.status)}`) : ''}
                </Badge>
              )}
              {sales_type && (
                <Badge {...getSalesTypeBadgeProps(sales_type)}>
                  {t(`item.salesType.badge.${sales_type}`)}
                </Badge>
              )}
              {item.rental_self_service && (
                <Tooltip
                  multiline
                  w={240}
                  label={
                    <div>
                      <Text size="sm" fw={500}>
                        {t('item.instantRental')}
                      </Text>
                      <Text size="xs">{t('item.instantRentalTooltip')}</Text>
                    </div>
                  }
                >
                  <Badge color="yellow" className="cursor-default">
                    <Zap size={12} className="fill-current block" />
                  </Badge>
                </Tooltip>
              )}
            </div>

            <h1 className="text-3xl font-bold leading-tight">{name}</h1>

            <Text component="div" size="sm" c="dimmed" className="flex items-center gap-2">
              <Calendar size={16} />
              <span>
                {t('itemDetail.listed')}{' '}
                {formatDistanceToNow(new Date(created_at), { addSuffix: true })}
              </span>
            </Text>

            {price && (
              <p className="text-2xl font-bold">
                {formatPrice(price, price_currency)}
                {isRental && (
                  <span className="ml-1 text-base font-normal">{t('time.perHour')}</span>
                )}
              </p>
            )}
          </div>

          {description !== undefined && description !== '' && (
            <Text c="dimmed">{convertLineBreaks(description)}</Text>
          )}

          {properties.length > 0 && (
            <div className="space-y-2">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase" className="tracking-wide">
                {t('itemDetail.properties')}
              </Text>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {properties.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-medium capitalize text-[var(--mantine-color-dimmed)]">
                      {key}
                    </dt>
                    <dd className="break-words">{formatPropertyValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Owner details are shown to logged-in users only */}
          {user && <UserInfoBox userUuid={item.user} />}

          {/* Action buttons */}
          {(isOwner || showBookingAction) && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {isOwner && (
                <>
                  <ActionIcon
                    component={Link}
                    to={category === 'books' ? `/edit-book/${item.id}` : `/edit-item/${item.id}`}
                    variant="outline"
                    size="lg"
                    aria-label={t('common.edit')}
                  >
                    <Edit3 size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="filled"
                    color="red"
                    size="lg"
                    onClick={openDeleteConfirm}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </>
              )}

              {showBookingAction &&
                (user ? (
                  bookingDialog
                ) : (
                  <Tooltip label={t('auth.loginRequired')}>
                    <span className="inline-block">{bookingDialog}</span>
                  </Tooltip>
                ))}
            </div>
          )}

          {/* Add to collection — always shown to logged-in users */}
          {user && <AddToCollectionPopover itemId={item.id} />}

          {/* Collections this item appears in */}
          {user && itemCollections && itemCollections.length > 0 && (
            <div className="space-y-2">
              <Text component="div" size="sm" c="dimmed" className="flex items-center gap-2">
                <BookMarked size={16} />
                <span>{t('collections.appearsIn')}</span>
              </Text>
              <div className="flex flex-wrap gap-2">
                {itemCollections.map(col => (
                  <Link
                    key={col.id}
                    to={`/collections/${col.id}`}
                    onClick={e => e.stopPropagation()}
                  >
                    <Badge variant="light" color="gray" className="cursor-pointer">
                      {col.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rental calendar — only for rental items and logged-in users */}
      {isRental && !!user && (
        <div className="mt-10" id="booking" ref={rentalCalendarRef}>
          <RentalCalendar
            itemUuid={itemUuid}
            onDateRangeSelect={handleDateRangeSelect}
            selectedStart={selectedStartDate}
            selectedEnd={selectedEndDate}
            onBookNow={handleBookNowFromCalendar}
          />
        </div>
      )}
    </div>
  );
};

export default ItemDetail;

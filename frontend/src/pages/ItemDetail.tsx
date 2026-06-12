import { BookingDialog } from '@/components/items/BookingDialog';
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
import { SalesTypeEnum } from '@/services/django';
import { ActionIcon, Badge, Button, Text, Tooltip } from '@mantine/core';
import { Carousel } from '@mantine/carousel';
import { modals } from '@mantine/modals';
import { formatDistanceToNow } from 'date-fns';
import type { EmblaCarouselType } from 'embla-carousel';
import { getCategoryIcon } from '@/lib/categoryIcons';
import {
  ArrowLeft,
  BookMarked,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

const ItemDetail = () => {
  const { itemUuid } = useParams<{ itemUuid: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { data: item, isLoading, error } = useItem(itemUuid);
  const deleteItemMutation = useDeleteItem();
  const { data: itemCollections } = useItemCollections(user ? itemUuid : undefined);

  const [showAllImages, setShowAllImages] = useState(false);
  const [selectedStartDate, setSelectedStartDate] = useState<Date | undefined>();
  const [selectedEndDate, setSelectedEndDate] = useState<Date | undefined>();
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // embla apis exposed by Mantine Carousel - configure for single full-width slide (no peek)
  const emblaOptions = { loop: false, align: 'center', containScroll: 'trimSnaps' } as const;
  const [emblaApi, setEmblaApi] = useState<EmblaCarouselType | null>(null);
  const [emblaFsApi, setEmblaFsApi] = useState<EmblaCarouselType | null>(null);

  // open fullscreen viewer at a given index
  const openFullscreen = (index: number) => {
    setActiveIndex(index);
    setShowAllImages(true);
    // try to scroll fullscreen embla immediately if available
    if (emblaFsApi) emblaFsApi.scrollTo(index);
  };

  const handleDateRangeSelect = (start: Date, end: Date) => {
    setSelectedStartDate(start);
    setSelectedEndDate(end);
  };

  const handleBookNowFromCalendar = (start: Date, end: Date) => {
    setSelectedStartDate(start);
    setSelectedEndDate(end);
    setShowBookingDialog(true);
  };

  const isOwner = useMemo(() => {
    if (!user || !item) return false;
    return item.user === user.id;
  }, [user, item]);

  const location = useLocation();
  const rentalCalendarRef = useRef<HTMLDivElement | null>(null);

  // If the URL contains #booking, scroll to the start of the booking calendar and open booking UI
  useEffect(() => {
    const hash = location.hash;
    if (hash === '#booking' && rentalCalendarRef.current) {
      try {
        rentalCalendarRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // ignore
      }
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [location.hash]);

  const handleDelete = async () => {
    if (!item) return;
    await deleteItemMutation.mutateAsync(item.id, {
      onSuccess: () => {
        navigate('/my-items');
      },
    });
  };

  const openDeleteConfirm = () =>
    modals.openConfirmModal({
      title: t('itemDetail.deleteConfirmTitle'),
      children: <Text size="sm">{t('itemDetail.deleteConfirmDescription')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        void handleDelete();
      },
    });

  // when opening fullscreen, ensure fullscreen embla is on the correct slide
  useEffect(() => {
    if (showAllImages && typeof activeIndex === 'number' && emblaFsApi) {
      emblaFsApi.scrollTo(activeIndex);
    }
  }, [showAllImages, activeIndex, emblaFsApi]);

  const scrollPrev = useCallback((api: EmblaCarouselType | null) => api?.scrollPrev(), []);
  const scrollNext = useCallback((api: EmblaCarouselType | null) => api?.scrollNext(), []);

  // keyboard navigation: left/right arrows control the current visible carousel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        // close fullscreen preview
        setShowAllImages(false);
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (showAllImages) scrollPrev(emblaFsApi);
        else scrollPrev(emblaApi);
      } else if (e.key === 'ArrowRight') {
        if (showAllImages) scrollNext(emblaFsApi);
        else scrollNext(emblaApi);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emblaApi, emblaFsApi, showAllImages, scrollPrev, scrollNext]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">{t('common.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-center py-10">
        <Text c="red">{error.message}</Text>
        <Button component={Link} to="/" mt="md">
          Back to Home
        </Button>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-background text-center py-10">
        <p>Item not found.</p>
        <Button component={Link} to="/" mt="md">
          Back to Home
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

  const conditionMap: Record<number, string> = {
    0: t('condition.new'),
    1: t('condition.used'),
    2: t('condition.broken'),
  };

  function getConditionLabel(conditionId: number | undefined) {
    if (conditionId !== undefined) {
      return conditionMap[conditionId];
    }
    return t('condition.unknown');
  }

  return (
    <>
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Button
          variant="subtle"
          onClick={() => navigate(-1)}
          mb="md"
          leftSection={<ArrowLeft size={16} />}
        >
          {t('common.back')}
        </Button>

        <div
          className={cn(
            'grid gap-8',
            images.length > 0 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1',
          )}
        >
          {/* Image Carousel - only show if there are images */}
          {images.length > 0 ? (
            <div className="relative">
              <Carousel
                emblaOptions={emblaOptions}
                withControls={false}
                getEmblaApi={setEmblaApi}
                onSlideChange={setActiveIndex}
              >
                {images.map((image, index) => (
                  <Carousel.Slide key={index}>
                    {/* reduced thumbnail height; smaller on mobile, larger on desktop */}
                    <div className="w-full h-40 md:h-56 lg:h-72 overflow-hidden rounded-lg relative">
                      <img
                        src={image.preview || image.original}
                        alt={`${name} ${index + 1}`}
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => openFullscreen(index)}
                      />
                    </div>
                  </Carousel.Slide>
                ))}
              </Carousel>
              {/* navigation: arrows (left) and dots (center) on same horizontal row */}
              {images.length > 1 && (
                <div className="mt-2 flex items-center w-full">
                  <div className="flex items-center gap-2">
                    <ActionIcon
                      variant="default"
                      size="lg"
                      onClick={() => scrollPrev(emblaApi)}
                      aria-label="Previous image"
                    >
                      <ChevronLeft size={20} />
                    </ActionIcon>
                    <ActionIcon
                      variant="default"
                      size="lg"
                      onClick={() => scrollNext(emblaApi)}
                      aria-label="Next image"
                    >
                      <ChevronRight size={20} />
                    </ActionIcon>
                  </div>

                  <div className="flex-1 flex justify-center">
                    <div className="flex items-center gap-2">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          aria-label={`Go to image ${idx + 1}`}
                          onClick={() => emblaApi && emblaApi.scrollTo(idx)}
                          className={`h-2 w-2 rounded-full ${
                            activeIndex === idx
                              ? 'bg-[var(--mantine-color-green-6)]'
                              : 'bg-gray-300'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Item Details */}
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-4">
                <Badge leftSection={createElement(getCategoryIcon(category), { size: 14 })}>
                  {t(`categories.${category}`)}
                </Badge>
                <Badge variant="light" color="gray">
                  {getConditionLabel(condition)}
                </Badge>
                {typeof item.status !== 'undefined' && item.status !== null && (
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
              <h1 className="text-3xl font-bold">{name}</h1>
              <Text component="div" size="sm" c="dimmed" className="flex items-center gap-2">
                <Calendar size={16} />
                <span>
                  {t('itemDetail.listed')}{' '}
                  {formatDistanceToNow(new Date(created_at), {
                    addSuffix: true,
                  })}
                </span>
              </Text>
            </div>

            <div className="space-y-4">
              {price && (
                <p className="text-2xl font-bold">
                  {formatPrice(price, price_currency)}
                  {isRental && (
                    <span className="text-base font-normal ml-1">{t('time.perHour')}</span>
                  )}
                </p>
              )}
            </div>

            <Text c="dimmed">{description !== undefined && convertLineBreaks(description)}</Text>

            {/* Properties */}
            {item.properties &&
            typeof item.properties === 'object' &&
            !Array.isArray(item.properties) &&
            Object.keys(item.properties).length > 0 ? (
              <div className="space-y-2">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase" className="tracking-wide">
                  {t('itemDetail.properties')}
                </Text>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {Object.entries(item.properties as Record<string, unknown>)
                    .filter(([key]) => key !== 'metadata')
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="font-medium capitalize text-[var(--mantine-color-dimmed)]">
                          {key}
                        </dt>
                        <dd className="break-words">
                          {value === null || value === undefined
                            ? '—'
                            : Array.isArray(value)
                              ? value.join(', ')
                              : typeof value === 'object'
                                ? JSON.stringify(value)
                                : String(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}

            {/* Show owner details to logged-in users only */}
            {user && <UserInfoBox userUuid={item.user} />}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-4">
              {/* Owner controls: edit & delete */}
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

              {/* Booking dialog: show for non-owners, and also for owners when rentable; always for wanted items */}
              {(!isOwner || isRental || isWanted) && (
                <div className={isOwner ? 'ml-2' : ''}>
                  <div>
                    {(() => {
                      const buyingAllowed = item.status === 2 || item.status === 3; // 2 = available, 3 = reserved

                      // Wanted items: no price/availability guard — the viewer is offering to the lister
                      const isDisabled =
                        !user ||
                        (isWanted
                          ? false
                          : (isOwner && !!price && !isRental) ||
                            (!buyingAllowed && !!price && !isRental));

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

                      const dialog = (
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
                          disabled={isDisabled}
                        />
                      );

                      if (!user) {
                        return (
                          <Tooltip label={t('auth.loginRequired')}>
                            <span className="inline-block">{dialog}</span>
                          </Tooltip>
                        );
                      }

                      return dialog;
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Add to collection — always shown to logged-in users */}
            {user && <AddToCollectionPopover itemId={item.id} />}

            {/* Collections this item appears in — only shown to logged-in users */}
            {user && itemCollections && itemCollections.length > 0 && (
              <div className="space-y-2 pt-2">
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

        {/* Rental Calendar - Only show for rental items and logged-in users */}
        {isRental && !!user && (
          <div className="mt-8" id="booking" ref={rentalCalendarRef}>
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

      {/* Full-screen image viewer */}
      {showAllImages && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80"
          onClick={() => setShowAllImages(false)}
        >
          <div
            className="relative w-full h-full max-w-4xl max-h-4xl"
            onClick={e => e.stopPropagation()}
          >
            <Carousel
              emblaOptions={emblaOptions}
              withControls={false}
              getEmblaApi={setEmblaFsApi}
              initialSlide={activeIndex}
              className="h-full w-full"
              styles={{
                viewport: { height: '100%' },
                container: { height: '100%' },
              }}
            >
              {images.map((image, index) => (
                <Carousel.Slide key={index} className="flex items-center justify-center">
                  <div className="w-full h-full flex items-center justify-center">
                    <img
                      src={image.preview || image.original}
                      alt={`${name} ${index + 1}`}
                      className="max-w-full max-h-full object-contain"
                      onClick={() => setShowAllImages(false)}
                    />
                  </div>
                </Carousel.Slide>
              ))}
            </Carousel>

            {images.length > 1 && (
              <div className="absolute inset-y-0 left-2 flex items-center z-50">
                <ActionIcon
                  variant="filled"
                  color="dark"
                  size="lg"
                  onClick={() => scrollPrev(emblaFsApi)}
                  aria-label="Previous image"
                >
                  <ChevronLeft size={24} />
                </ActionIcon>
              </div>
            )}
            {images.length > 1 && (
              <div className="absolute inset-y-0 right-2 flex items-center z-50">
                <ActionIcon
                  variant="filled"
                  color="dark"
                  size="lg"
                  onClick={() => scrollNext(emblaFsApi)}
                  aria-label="Next image"
                >
                  <ChevronRight size={24} />
                </ActionIcon>
              </div>
            )}

            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              c="white"
              className="absolute top-4 right-4"
              onClick={() => setShowAllImages(false)}
              aria-label="Close"
            >
              <X size={24} />
            </ActionIcon>
          </div>
        </div>
      )}
    </>
  );
};

export default ItemDetail;

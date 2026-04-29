import { BookingDialog } from '@/components/items/BookingDialog';
import { RentalCalendar } from '@/components/items/RentalCalendar';
import { getStatusColor, getStatusLabel } from '@/components/items/status';
import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { formatDistanceToNow } from 'date-fns';
import useEmblaCarousel from 'embla-carousel-react';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

const getSalesTypeBadgeColor = (st: SalesTypeEnum) => {
  switch (st) {
    case 'sell':
      return 'bg-primary text-primary-foreground';
    case 'donate':
    case 'borrow':
      return 'bg-success text-success-foreground';
    case 'rent':
      return 'bg-info text-info-foreground';
    case 'want_buy':
    case 'want_rent':
      return 'bg-muted text-muted-foreground border border-border';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

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
  // open fullscreen viewer at a given index
  const openFullscreen = (index: number) => {
    setActiveIndex(index);
    setShowAllImages(true);
    // try to scroll fullscreen embla immediately if available
    if (emblaFsApi && emblaFsApi.scrollTo) emblaFsApi.scrollTo(index);
  };

  // embla refs and api - configure for single full-width slide (no peek)
  const emblaOptions = { loop: false, align: 'center', containScroll: 'trimSnaps' } as const;
  const [emblaRef, emblaApi] = useEmblaCarousel(emblaOptions);
  const [emblaFsRef, emblaFsApi] = useEmblaCarousel(emblaOptions);

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

  useEffect(() => {
    if (emblaApi && emblaApi.reInit) emblaApi.reInit();
    if (emblaFsApi && emblaFsApi.reInit) emblaFsApi.reInit();

    // wire up select handler to keep track of active slide for dot indicators
    let removeSelect: (() => void) | undefined;
    if (emblaApi && emblaApi.on) {
      const onSelect = () => {
        const idx =
          typeof emblaApi.selectedScrollSnap === 'function' ? emblaApi.selectedScrollSnap() : 0;
        setActiveIndex(idx ?? 0);
      };
      emblaApi.on('select', onSelect);
      // set initial
      onSelect();
      removeSelect = () => emblaApi.off && emblaApi.off('select', onSelect);
    }

    return () => {
      if (removeSelect) removeSelect();
    };
  }, [emblaApi, emblaFsApi, item?.images]);

  // when opening fullscreen, ensure fullscreen embla is on the correct slide
  useEffect(() => {
    if (showAllImages && typeof activeIndex === 'number' && emblaFsApi && emblaFsApi.scrollTo) {
      emblaFsApi.scrollTo(activeIndex);
    }
  }, [showAllImages, activeIndex, emblaFsApi]);

  const scrollPrev = useCallback((api: any) => api && api.scrollPrev && api.scrollPrev(), []);
  const scrollNext = useCallback((api: any) => api && api.scrollNext && api.scrollNext(), []);

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
        <p className="text-destructive">{error.message}</p>
        <Button asChild className="mt-4">
          <Link to="/">Back to Home</Link>
        </Button>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-background text-center py-10">
        <p>Item not found.</p>
        <Button asChild className="mt-4">
          <Link to="/">Back to Home</Link>
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
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('common.back')}
        </Button>

        <div
          className={cn(
            'grid gap-8',
            images.length > 0 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1',
          )}
        >
          {/* Image Carousel (embla) - only show if there are images */}
          {images.length > 0 ? (
            <div className="relative">
              <div className="embla overflow-hidden">
                <div className="embla__viewport" ref={emblaRef}>
                  <div className="embla__container flex">
                    {images.map((image, index) => (
                      <div key={index} className="embla__slide flex-none w-full">
                        {/* reduced thumbnail height; smaller on mobile, larger on desktop */}
                        <div className="w-full h-40 md:h-56 lg:h-72 overflow-hidden rounded-lg relative">
                          <img
                            src={image.preview || image.original}
                            alt={`${name} ${index + 1}`}
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => openFullscreen(index)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* navigation: arrows (left) and dots (center) on same horizontal row */}
              {images.length > 1 && (
                <div className="mt-2 flex items-center w-full">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => scrollPrev(emblaApi)}
                      className="bg-white/80 hover:bg-white/95 text-black shadow-xs"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => scrollNext(emblaApi)}
                      className="bg-white/80 hover:bg-white/95 text-black shadow-xs"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>

                  <div className="flex-1 flex justify-center">
                    <div className="flex items-center gap-2">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          aria-label={`Go to image ${idx + 1}`}
                          onClick={() => emblaApi && emblaApi.scrollTo(idx)}
                          className={`h-2 w-2 rounded-full ${
                            activeIndex === idx ? 'bg-primary' : 'bg-gray-300'
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
                {(() => {
                  const CategoryIcon = getCategoryIcon(category);
                  return (
                    <Badge className="gap-1.5">
                      <CategoryIcon className="h-3.5 w-3.5" />
                      {t(`categories.${category}`)}
                    </Badge>
                  );
                })()}
                <Badge variant="secondary">{getConditionLabel(condition)}</Badge>
                {typeof item.status !== 'undefined' && item.status !== null && (
                  <Badge className={cn(getStatusColor(item.status), 'text-xs')}>
                    {getStatusLabel(item.status) ? t(`status.${getStatusLabel(item.status)}`) : ''}
                  </Badge>
                )}
                {sales_type && (
                  <Badge className={cn(getSalesTypeBadgeColor(sales_type), 'text-xs')}>
                    {t(`item.salesType.badge.${sales_type}`)}
                  </Badge>
                )}
                {item.rental_self_service && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge className="gap-1 bg-amber-500 text-white text-xs hover:bg-amber-500 cursor-default">
                          <Zap className="h-3 w-3 fill-current" />
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{t('item.instantRental')}</p>
                        <p className="text-xs text-muted-foreground max-w-56">
                          {t('item.instantRentalTooltip')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <h1 className="text-3xl font-bold">{name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>
                  {t('itemDetail.listed')}{' '}
                  {formatDistanceToNow(new Date(created_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
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

            <p className="text-muted-foreground">
              {description !== undefined && convertLineBreaks(description)}
            </p>

            {/* Properties */}
            {item.properties &&
              typeof item.properties === 'object' &&
              !Array.isArray(item.properties) &&
              Object.keys(item.properties).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {t('itemDetail.properties')}
                  </h3>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    {Object.entries(item.properties as Record<string, unknown>)
                      .filter(([key]) => key !== 'metadata')
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="font-medium capitalize text-muted-foreground">{key}</dt>
                          <dd className="text-foreground break-words">
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
              )}

            {/* Show owner details to logged-in users only */}
            {user && <UserInfoBox userUuid={item.user} />}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-4">
              {/* Owner controls: edit & delete */}
              {isOwner && (
                <>
                  <Button asChild variant="outline">
                    <Link
                      to={category === 'books' ? `/edit-book/${item.id}` : `/edit-item/${item.id}`}
                    >
                      <Edit3 className="mr-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('itemDetail.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('itemDetail.deleteConfirmDescription')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>
                          {t('common.delete')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
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
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-block">{dialog}</span>
                              </TooltipTrigger>
                              <TooltipContent>{t('auth.loginRequired')}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BookMarked className="h-4 w-4" />
                  <span>{t('collections.appearsIn')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {itemCollections.map(col => (
                    <Link
                      key={col.id}
                      to={`/collections/${col.id}`}
                      onClick={e => e.stopPropagation()}
                    >
                      <Badge
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/70 transition-colors"
                      >
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
            <div className="embla embla--fullscreen h-full w-full">
              <div className="embla__viewport h-full" ref={emblaFsRef}>
                <div className="embla__container flex h-full">
                  {images.map((image, index) => (
                    <div
                      key={index}
                      className="embla__slide flex-none w-full flex items-center justify-center"
                    >
                      <div className="w-full h-full flex items-center justify-center">
                        <img
                          src={image.preview || image.original}
                          alt={`${name} ${index + 1}`}
                          className="max-w-full max-h-full object-contain"
                          onClick={() => setShowAllImages(false)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {images.length > 1 && (
              <div className="absolute inset-y-0 left-2 flex items-center z-50">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => scrollPrev(emblaFsApi)}
                  className="text-white bg-black/40 hover:bg-black/50 shadow-lg"
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
              </div>
            )}
            {images.length > 1 && (
              <div className="absolute inset-y-0 right-2 flex items-center z-50">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => scrollNext(emblaFsApi)}
                  className="text-white bg-black/40 hover:bg-black/50 shadow-lg"
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </div>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 text-white hover:bg-white/20"
              onClick={() => setShowAllImages(false)}
            >
              <X className="h-6 w-6" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default ItemDetail;

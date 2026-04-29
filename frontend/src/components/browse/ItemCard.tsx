import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
import { BookingDialog } from '@/components/items/BookingDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { formatPrice } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { SalesTypeEnum, Status402Enum } from '@/services/django';
import { Clock, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getStatusColor, getStatusLabel } from '@/components/items/status';
import { convertLineBreaks } from '@/lib/convertLineBreaks';

interface ItemCardProps {
  id: string;
  title?: string;
  description: string;
  category?: string;
  condition: 'new' | 'used' | 'broken';
  salesType?: SalesTypeEnum;
  price?: number;
  priceCurrency?: string | null;
  location: string;
  imageUrl?: string;
  ownerAvatar?: string;
  createdAt: string;
  isFavorited?: boolean;
  ownerId?: string;
  owner?: string;
  status?: Status402Enum | null;
  rentalOpenEnd?: boolean;
  rentalSelfService?: boolean;
}

export const ItemCard = ({
  id,
  title,
  description,
  category,
  condition,
  salesType,
  price,
  priceCurrency,
  location,
  imageUrl,
  ownerAvatar,
  createdAt,
  isFavorited = false,
  owner,
  status,
  rentalOpenEnd = false,
  rentalSelfService = false,
}: ItemCardProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, language } = useLanguage();

  const isOwner = user && owner && user.id === owner;
  const isRentable = salesType === 'rent' || salesType === 'borrow';

  const getActionLabel = (st: SalesTypeEnum | undefined): string => {
    switch (st) {
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
  };

  const conditionColors = {
    new: 'bg-success text-success-foreground',
    used: 'bg-warning text-warning-foreground',
    broken: 'bg-destructive text-destructive-foreground',
  };

  const salesTypeBadgeColor = (st: SalesTypeEnum | undefined) => {
    switch (st) {
      case 'sell':
        return 'bg-muted text-info-foreground';
      case 'donate':
      case 'borrow':
        return 'bg-success text-success-foreground';
      case 'rent':
        return 'bg-muted text-info-foreground';
      case 'want_buy':
      case 'want_rent':
        return 'bg-muted text-muted-foreground border border-border';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card
      className="group overflow-hidden transition-all duration-300 hover:shadow-strong hover:scale-105 border-border animate-fade-in cursor-pointer"
      onClick={() => navigate(`/item/${id}`)}
    >
      {/* Image Section */}
      <div className="relative aspect-4/3 overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
          />
        ) : (
          (() => {
            const CategoryIcon = getCategoryIcon(category);
            return (
              <div className="flex h-full w-full items-center justify-center bg-gradient-subtle">
                <CategoryIcon className="h-16 w-16 text-muted-foreground/50" />
              </div>
            );
          })()
        )}

        {/* Overlay badges */}
        <div className="absolute top-3 left-3 flex gap-2">
          {/* Status badge (shows available/reserved/sold/...) */}
          {typeof status !== 'undefined' && status !== null ? (
            <Badge className={cn(getStatusColor(status), 'text-xs shadow-medium')}>
              {getStatusLabel(status) ? t(`status.${getStatusLabel(status)}`) : ''}
            </Badge>
          ) : null}
        </div>

        {/* Sales type badge (top-right) */}
        {salesType && (
          <div className="absolute top-3 right-3">
            <Badge className={cn(salesTypeBadgeColor(salesType), 'text-xs shadow-medium')}>
              {t(`item.salesType.badge.${salesType}`)}
            </Badge>
          </div>
        )}

        {/* Instant Rental badge (bottom-left) */}
        {rentalSelfService && (
          <div className="absolute bottom-3 left-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="gap-1 bg-amber-500 text-white text-xs shadow-medium hover:bg-amber-500 cursor-default">
                    <Zap className="h-3 w-3 fill-current" />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{t('item.instantRental')}</p>
                  <p className="text-xs text-muted-foreground max-w-48">
                    {t('item.instantRentalTooltip')}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Price overlay */}
        {price !== undefined && (
          <div className="absolute bottom-3 right-3">
            <div className="rounded-lg bg-background/90 backdrop-blur-xs px-3 py-1 shadow-medium">
              <div className="flex items-center gap-1 text-sm font-semibold">
                {formatPrice(price, priceCurrency)}
                {(salesType === 'rent' || salesType === 'borrow') && (
                  <span className="text-xs font-normal">{t('time.perHour')}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content Section */}
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {convertLineBreaks(description)}
          </p>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatDate(createdAt, language)}</span>
          </div>
        </div>
      </CardContent>

      {/* Actions */}
      <CardFooter
        className="p-4 pt-0 flex gap-2"
        onClick={e => {
          e.stopPropagation();
        }}
      >
        {(() => {
          const buyingAllowed = status === 2 || status === 3; // 2 = available, 3 = reserved

          // Rentable items (rent/borrow): navigate to calendar on item detail page
          // No ownership restriction — owners should be able to rent/borrow their own items
          if (isRentable) {
            return (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex flex-1 gap-2">
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={e => {
                          e.stopPropagation();
                          navigate(`/item/${id}#booking`);
                        }}
                        disabled={!user}
                      >
                        {getActionLabel(salesType)}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  {!user && (
                    <TooltipContent>
                      <p>{t('auth.loginRequired')}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            );
          }

          // Wanted items: open booking dialog so the viewer can contact/offer
          if (salesType === 'want_buy' || salesType === 'want_rent') {
            return (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex flex-1 gap-2">
                      <BookingDialog
                        itemUuid={id}
                        itemName={title}
                        price={price?.toString()}
                        priceCurrency={priceCurrency || undefined}
                        salesType={salesType}
                        rentalOpenEnd={rentalOpenEnd}
                        buttonSize="sm"
                        buttonClassName="w-full"
                        triggerLabel={getActionLabel(salesType)}
                        disabled={isOwner || !user}
                      />
                    </div>
                  </TooltipTrigger>
                  {(!user || isOwner) && (
                    <TooltipContent>
                      <p>{!user ? t('auth.loginRequired') : t('item.cannotMessageSelf')}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            );
          }

          // sell / donate: open booking dialog
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex flex-1 gap-2">
                    <BookingDialog
                      itemUuid={id}
                      itemName={title}
                      price={price?.toString()}
                      priceCurrency={priceCurrency || undefined}
                      salesType={salesType}
                      rentalOpenEnd={rentalOpenEnd}
                      buttonSize="sm"
                      buttonClassName="w-full"
                      triggerLabel={getActionLabel(salesType)}
                      disabled={(isOwner && !!price) || !user || !buyingAllowed}
                    />
                  </div>
                </TooltipTrigger>
                {(!user || isOwner) && (
                  <TooltipContent>
                    <p>{!user ? t('auth.loginRequired') : t('item.cannotMessageSelf')}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          );
        })()}
        <AddToCollectionPopover itemId={id} iconOnly />
      </CardFooter>
    </Card>
  );
};

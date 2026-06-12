import { AddToCollectionPopover } from '@/components/collections/AddToCollectionPopover';
import { BookingDialog } from '@/components/items/BookingDialog';
import { getStatusLabel, getStatusMantineColor } from '@/components/items/status';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { convertLineBreaks } from '@/lib/convertLineBreaks';
import { formatPrice } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { SalesTypeEnum, StatusB0aEnum } from '@/services/django';
import { Badge, Button, Card, Text, Tooltip } from '@mantine/core';
import { Clock, Globe, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  status?: StatusB0aEnum | null;
  rentalOpenEnd?: boolean;
  rentalSelfService?: boolean;
  /** When set, shows an origin badge indicating this item is from a remote instance */
  remoteInstance?: string | null;
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
  remoteInstance,
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

  const salesTypeBadgeProps = (
    st: SalesTypeEnum | undefined,
  ): { color: string; variant: 'filled' | 'light' | 'outline' } => {
    switch (st) {
      case 'donate':
      case 'borrow':
        return { color: 'teal', variant: 'filled' };
      case 'want_buy':
      case 'want_rent':
        return { color: 'gray', variant: 'outline' };
      case 'sell':
      case 'rent':
      default:
        return { color: 'gray', variant: 'light' };
    }
  };

  return (
    <Card
      withBorder
      padding="lg"
      className="group overflow-hidden transition-all duration-300 hover:shadow-strong hover:scale-105 animate-fade-in cursor-pointer"
      onClick={() => navigate(`/item/${id}`)}
    >
      {/* Image Section */}
      <Card.Section className="relative aspect-4/3 overflow-hidden">
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
            <Badge color={getStatusMantineColor(status)} size="sm" className="shadow-medium">
              {getStatusLabel(status) ? t(`status.${getStatusLabel(status)}`) : ''}
            </Badge>
          ) : null}
        </div>

        {/* Sales type badge (top-right) */}
        {salesType && (
          <div className="absolute top-3 right-3">
            <Badge {...salesTypeBadgeProps(salesType)} size="sm" className="shadow-medium">
              {t(`item.salesType.badge.${salesType}`)}
            </Badge>
          </div>
        )}

        {/* Bottom-left badges: instant rental + remote origin */}
        {(rentalSelfService || remoteInstance) && (
          <div className="absolute bottom-3 left-3 flex flex-col gap-1 items-start">
            {rentalSelfService && (
              <Tooltip
                multiline
                label={
                  <div>
                    <Text size="sm" fw={500}>
                      {t('item.instantRental')}
                    </Text>
                    <Text size="xs" className="max-w-48">
                      {t('item.instantRentalTooltip')}
                    </Text>
                  </div>
                }
              >
                <Badge color="yellow" size="sm" className="shadow-medium cursor-default">
                  <Zap size={12} className="fill-current" />
                </Badge>
              </Tooltip>
            )}
            {remoteInstance && (
              <Tooltip label={remoteInstance}>
                <Badge
                  color="blue"
                  size="sm"
                  leftSection={<Globe size={12} />}
                  className="shadow-medium cursor-default backdrop-blur-xs"
                >
                  <span className="max-w-24 truncate">{remoteInstance}</span>
                </Badge>
              </Tooltip>
            )}
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
      </Card.Section>

      {/* Content Section */}
      <div className="mt-4 space-y-3">
        <div>
          <h3 className="font-semibold line-clamp-1 group-hover:text-primary transition-colors">
            {title}
          </h3>
          <Text size="sm" c="dimmed" lineClamp={2} className="mt-1">
            {convertLineBreaks(description)}
          </Text>
        </div>

        <Text size="xs" c="dimmed" component="div" className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Clock size={12} />
            <span>{formatDate(createdAt, language)}</span>
          </div>
        </Text>
      </div>

      {/* Actions */}
      <div
        className="mt-4 flex gap-2"
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
              <Tooltip label={t('auth.loginRequired')} disabled={!!user}>
                <div className="flex flex-1 gap-2">
                  <Button
                    size="sm"
                    fullWidth
                    onClick={e => {
                      e.stopPropagation();
                      navigate(`/item/${id}#booking`);
                    }}
                    disabled={!user}
                  >
                    {getActionLabel(salesType)}
                  </Button>
                </div>
              </Tooltip>
            );
          }

          // Wanted items: open booking dialog so the viewer can contact/offer
          if (salesType === 'want_buy' || salesType === 'want_rent') {
            return (
              <Tooltip
                label={!user ? t('auth.loginRequired') : t('item.cannotMessageSelf')}
                disabled={!!user && !isOwner}
              >
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
              </Tooltip>
            );
          }

          // sell / donate: open booking dialog
          return (
            <Tooltip
              label={!user ? t('auth.loginRequired') : t('item.cannotMessageSelf')}
              disabled={!!user && !isOwner}
            >
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
            </Tooltip>
          );
        })()}
        <AddToCollectionPopover itemId={id} iconOnly />
      </div>
    </Card>
  );
};

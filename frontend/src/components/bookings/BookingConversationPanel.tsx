import BookingCounterOfferDialog from '@/components/bookings/BookingCounterOfferDialog';
import BookingEditDialog from '@/components/bookings/BookingEditDialog';
import { getBookingStatusBadge } from '@/components/bookings/status';
import { RecordPaymentPrompt } from '@/components/payments/RecordPaymentPrompt';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import {
  useBooking,
  useConfirmReceived,
  useConfirmReturned,
  useUpdateBooking,
} from '@/hooks/useBookings';
import { useItem } from '@/hooks/useItem';
import { useCreateMessage, useMarkMessageAsRead, useMessages } from '@/hooks/useMessages';
import { formatPrice, getRentalPeriodSuffixKey } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { BookingWithPayment } from '@/services/custom/payments';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  ScrollArea,
  Text,
  TextInput,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { format } from 'date-fns';
import { ArrowLeft, Calendar, Clock, Package, RefreshCw, Send, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

interface BookingConversationPanelProps {
  /** The booking whose conversation should be shown. Undefined renders the
   *  "select a booking" placeholder instead. */
  bookingId?: string | null;
  /** Shown as a mobile-only back button in the header when provided. */
  onBack?: () => void;
}

/** Right-hand pane of the Bookings page: booking details, status actions and
 *  the message thread for a single booking. */
const BookingConversationPanel = ({ bookingId, onBack }: BookingConversationPanelProps) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { data: selectedBooking, isLoading } = useBooking(bookingId || undefined);
  const { data: selectedItemDetails } = useItem(selectedBooking?.item_details?.id);
  const [messageText, setMessageText] = useState('');
  const updateBookingMutation = useUpdateBooking();
  const confirmReceivedMutation = useConfirmReceived();
  const confirmReturnedMutation = useConfirmReturned();
  const {
    data: messagesData,
    refetch: refetchMessages,
    isFetching: isFetchingMessages,
  } = useMessages(bookingId || undefined);
  const createMessageMutation = useCreateMessage();
  const markMessageAsReadMutation = useMarkMessageAsRead();

  const messages = useMemo(() => {
    // Sort messages by created_at ascending (oldest first, newest last)
    const messageList = messagesData?.results || [];
    return [...messageList].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messagesData]);

  // The payment fields are served by the bookings endpoint but are not part
  // of the generated Booking type yet — see services/custom/payments.ts.
  const payableBooking = selectedBooking as unknown as BookingWithPayment | undefined;
  // Only the person who received the item is asked what they paid.
  const showPaymentPrompt = Boolean(
    payableBooking?.payment_recordable && user?.username === selectedBooking?.user?.username,
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const markedAsReadRef = useRef<Set<string>>(new Set());

  // Auto-mark unread messages as read when displayed
  useEffect(() => {
    if (!messages || !user) return;

    const unreadMessages = messages.filter(
      message =>
        message.is_read === false &&
        message.sender !== user.username &&
        message.id &&
        !markedAsReadRef.current.has(message.id),
    );

    unreadMessages.forEach(message => {
      if (message.id) {
        markedAsReadRef.current.add(message.id);
        markMessageAsReadMutation.mutate(message.id);
      }
    });
  }, [messages, user, markMessageAsReadMutation]);

  const getStatusBadge = (status?: number) => {
    const { color, variant, labelKey } = getBookingStatusBadge(status);
    return (
      <Badge color={color} variant={variant}>
        {t(labelKey)}
      </Badge>
    );
  };

  const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return '';
    try {
      return format(new Date(dateString), 'EEE, MMM d, yyyy HH:mm');
    } catch {
      return dateString;
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || !bookingId) return;

    try {
      await createMessageMutation.mutateAsync({
        booking: bookingId,
        message: messageText,
      });
      setMessageText('');
      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 0);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  if (!bookingId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Text component="div" c="dimmed" ta="center">
          <Calendar className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p>{t('requests.selectBooking')}</p>
        </Text>
      </div>
    );
  }

  // A selected-but-not-yet-loaded booking is its own state: showing the
  // "select a booking" placeholder here would contradict the user's click.
  if (isLoading || !selectedBooking) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Text c="dimmed">{t('common.loading')}</Text>
      </div>
    );
  }

  return (
    <>
      {/* Booking Header */}
      <div className="p-4 border-b shrink-0">
        <div className="flex items-start gap-3 md:gap-4 mb-4">
          {onBack && (
            // Mantine's own responsive prop rather than a Tailwind `md:hidden`:
            // the ActionIcon root class is unlayered and would otherwise win the
            // cascade, leaving the back button visible on desktop.
            <ActionIcon
              variant="subtle"
              size="lg"
              hiddenFrom="md"
              className="shrink-0"
              onClick={onBack}
              aria-label={t('common.back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </ActionIcon>
          )}

          {/* Item Thumbnail */}
          <Link
            to={`/item/${selectedBooking.item_details?.id || selectedBooking.item}`}
            className="shrink-0"
          >
            <Box
              className="w-14 h-14 md:w-20 md:h-20 rounded overflow-hidden"
              bg="var(--mantine-color-default-hover)"
            >
              {selectedBooking.item_details?.first_image ? (
                <img
                  src={selectedBooking.item_details.first_image}
                  alt={selectedBooking.item_details?.name || 'Item'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </Box>
          </Link>

          {/* Item Info */}
          <div className="flex-1 min-w-0">
            <Link
              to={`/item/${selectedBooking.item_details?.id || selectedBooking.item}`}
              className="text-lg md:text-xl font-bold mb-2 hover:underline block"
            >
              {selectedBooking.item_details?.name || t('requests.unknownItem')}
            </Link>
            <div className="space-y-1">
              <Text component="div" size="sm" className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>
                  {t('requests.requestFrom')}{' '}
                  <span className="font-medium">
                    {selectedBooking.user?.name || selectedBooking.user?.username || 'Unknown'}
                  </span>
                </span>
              </Text>
              <Text component="div" size="sm" c="dimmed" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>{formatDateTime(selectedBooking.created_at)}</span>
              </Text>
            </div>
          </div>

          {/* Status Badge */}
          <div className="shrink-0">{getStatusBadge(selectedBooking.status)}</div>
        </div>

        {/* Booking Details */}
        <Box
          bg="var(--mantine-color-default-hover)"
          className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-lg"
        >
          {selectedItemDetails && selectedItemDetails.price && (
            <div>
              <Text size="xs" fw={500} className="mb-1">
                {selectedItemDetails.sales_type === 'rent'
                  ? t('booking.listedRentalPrice')
                  : t('booking.listedPrice')}
              </Text>
              <Text size="lg" c="dimmed">
                {selectedItemDetails.sales_type === 'rent'
                  ? `${formatPrice(
                      selectedItemDetails.price,
                      selectedItemDetails.price_currency,
                    )} ${t(getRentalPeriodSuffixKey(selectedItemDetails.rental_period))}`
                  : formatPrice(selectedItemDetails.price, selectedItemDetails.price_currency)}
              </Text>
            </div>
          )}
          {selectedBooking.offer && (
            <div>
              <Text size="xs" className="mb-1">
                {t('requests.offerAmount')}
              </Text>
              <Text size="lg" fw={700}>
                {formatPrice(selectedBooking.offer, 'EUR')}
              </Text>
            </div>
          )}
          {selectedBooking.time_from && selectedBooking.time_to && (
            <div>
              <Text size="sm" fw={500} className="mb-1">
                {t('requests.rentalPeriod')}
              </Text>
              <Text size="sm">
                <Clock className="inline h-3 w-3 mr-1" />
                {formatDateTime(selectedBooking.time_from)}
              </Text>
              <Text size="sm">
                <Clock className="inline h-3 w-3 mr-1" />
                {formatDateTime(selectedBooking.time_to)}
              </Text>
            </div>
          )}
          {selectedBooking.counter_offer && (
            <div>
              <Text size="xs" fw={500} className="mb-1">
                {t('requests.counterOffer')}
              </Text>
              <Text size="lg" fw={700} c="orange.5">
                {formatPrice(selectedBooking.counter_offer, 'EUR')}
              </Text>
            </div>
          )}
        </Box>

        {/* Payment — asked of the booker once the booking has completed, so
            the question is what it was worth rather than what to charge. */}
        {showPaymentPrompt && payableBooking && (
          <Box mt="md">
            <RecordPaymentPrompt
              booking={{
                ...payableBooking,
                item_name: selectedBooking.item_details?.name,
              }}
            />
          </Box>
        )}

        {/* Action Buttons - For pending bookings */}
        {selectedBooking.status === 1 && (
          <div className="flex items-center gap-2 mt-4">
            <div className="flex gap-2">
              {user?.username === selectedBooking.user?.username ? (
                <>
                  {selectedBooking.counter_offer &&
                    selectedBooking.counter_offer !== selectedBooking.offer && (
                      <Button
                        color="teal"
                        onClick={async () => {
                          try {
                            await updateBookingMutation.mutateAsync({
                              id: selectedBooking.id,
                              data: { offer: selectedBooking.counter_offer },
                            });
                          } catch (error) {
                            console.error('Error accepting counteroffer:', error);
                          }
                        }}
                        disabled={updateBookingMutation.isPending}
                      >
                        {updateBookingMutation.isPending
                          ? t('common.submitting')
                          : t('requests.acceptCounterOffer')}
                      </Button>
                    )}

                  <BookingEditDialog booking={selectedBooking} />
                  <Button
                    color="red"
                    onClick={async () => {
                      try {
                        await updateBookingMutation.mutateAsync({
                          id: selectedBooking.id,
                          data: { status: 2 }, // Cancelled
                        });
                      } catch (error) {
                        console.error('Error cancelling booking:', error);
                      }
                    }}
                    disabled={updateBookingMutation.isPending}
                  >
                    {updateBookingMutation.isPending
                      ? t('common.submitting')
                      : t('requests.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <BookingCounterOfferDialog booking={selectedBooking} />

                  <Button
                    color="green"
                    onClick={() => {
                      const itemPrice = selectedItemDetails?.price;
                      const offerDiffersFromItem =
                        !!selectedBooking.offer && selectedBooking.offer !== itemPrice;
                      const offerDiffersFromCounter =
                        !!selectedBooking.counter_offer &&
                        selectedBooking.offer !== selectedBooking.counter_offer;

                      if (offerDiffersFromItem && offerDiffersFromCounter) {
                        modals.openConfirmModal({
                          title: t('requests.acceptWarningTitle'),
                          children: (
                            <Text size="sm">
                              {t('requests.acceptWarningDescription')?.replace(
                                '{amount}',
                                String(selectedBooking.offer ?? ''),
                              )}
                            </Text>
                          ),
                          labels: {
                            confirm: t('requests.accept'),
                            cancel: t('common.cancel'),
                          },
                          onConfirm: async () => {
                            try {
                              await updateBookingMutation.mutateAsync({
                                id: selectedBooking.id,
                                data: { status: 3 },
                              });
                            } catch (error) {
                              console.error('Error accepting booking after warning:', error);
                            }
                          },
                        });
                        return;
                      }

                      (async () => {
                        try {
                          await updateBookingMutation.mutateAsync({
                            id: selectedBooking.id,
                            data: { status: 3 },
                          });
                        } catch (error) {
                          console.error('Error accepting booking:', error);
                        }
                      })();
                    }}
                    disabled={updateBookingMutation.isPending}
                  >
                    {updateBookingMutation.isPending
                      ? t('common.submitting')
                      : t('requests.accept')}
                  </Button>
                  <Button
                    color="red"
                    onClick={async () => {
                      try {
                        await updateBookingMutation.mutateAsync({
                          id: selectedBooking.id,
                          data: { status: 5 }, // Rejected
                        });
                      } catch (error) {
                        console.error('Error rejecting booking:', error);
                      }
                    }}
                    disabled={updateBookingMutation.isPending}
                  >
                    {updateBookingMutation.isPending
                      ? t('common.submitting')
                      : t('requests.reject')}
                  </Button>
                </>
              )}
            </div>

            <div className="ml-auto">
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => refetchMessages()}
                disabled={isFetchingMessages}
                aria-label={t('requests.refresh')}
              >
                <RefreshCw className={isFetchingMessages ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              </ActionIcon>
            </div>
          </div>
        )}

        {/* Action Buttons - For confirmed bookings */}
        {selectedBooking.status === 3 &&
          (() => {
            const isBuyer = user?.username === selectedBooking.user?.username;
            const salesType = selectedItemDetails?.sales_type;
            const isSale = salesType === 'sell' || salesType === 'donate';
            const isRental = salesType === 'rent' || salesType === 'borrow';
            const showConfirmReceived =
              isBuyer && (isSale || (isRental && !selectedItemDetails?.rental_self_service));
            // Once the rental period has ended there's nothing left to cancel -
            // cancelling it now wouldn't undo anything that already happened.
            const isPast =
              !!selectedBooking.time_to && new Date(selectedBooking.time_to) <= new Date();

            return (
              <div className="flex items-center gap-2 mt-4">
                {showConfirmReceived && (
                  <Button
                    color="teal"
                    onClick={() => confirmReceivedMutation.mutate(selectedBooking.id)}
                    disabled={confirmReceivedMutation.isPending}
                  >
                    {confirmReceivedMutation.isPending
                      ? t('common.submitting')
                      : t('requests.confirmReceived')}
                  </Button>
                )}
                {!isPast && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await updateBookingMutation.mutateAsync({
                          id: selectedBooking.id,
                          data: { status: 2 }, // Cancelled
                        });
                      } catch (error) {
                        console.error('Error cancelling booking:', error);
                      }
                    }}
                    disabled={updateBookingMutation.isPending}
                  >
                    {updateBookingMutation.isPending
                      ? t('common.submitting')
                      : t('requests.cancel')}
                  </Button>
                )}

                <div className="ml-auto">
                  <ActionIcon
                    variant="subtle"
                    size="lg"
                    onClick={() => refetchMessages()}
                    disabled={isFetchingMessages}
                    aria-label={t('requests.refresh')}
                  >
                    <RefreshCw
                      className={isFetchingMessages ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                    />
                  </ActionIcon>
                </div>
              </div>
            );
          })()}

        {/* Action Buttons - For in-progress rentals (owner confirms return) */}
        {selectedBooking.status === 6 && user?.username !== selectedBooking.user?.username && (
          <div className="flex items-center gap-2 mt-4">
            <Button
              color="teal"
              onClick={() => confirmReturnedMutation.mutate(selectedBooking.id)}
              disabled={confirmReturnedMutation.isPending}
            >
              {confirmReturnedMutation.isPending
                ? t('common.submitting')
                : t('requests.confirmReturned')}
            </Button>

            <div className="ml-auto">
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => refetchMessages()}
                disabled={isFetchingMessages}
                aria-label={t('requests.refresh')}
              >
                <RefreshCw className={isFetchingMessages ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              </ActionIcon>
            </div>
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            {messages.length === 0 ? (
              <Text component="div" c="dimmed" ta="center" className="py-8">
                <Text size="sm">{t('requests.noMessages')}</Text>
                <Text size="xs" className="mt-2">
                  {t('requests.startConversation')}
                </Text>
              </Text>
            ) : (
              <>
                {messages.map(message => {
                  const isOwnMessage = user?.username === message.sender;
                  return (
                    <div
                      key={message.id}
                      className={cn('flex', isOwnMessage ? 'justify-end' : 'justify-start')}
                    >
                      <Box
                        className="max-w-[70%] rounded-lg p-3 space-y-1"
                        bg={
                          isOwnMessage
                            ? 'var(--mantine-color-green-6)'
                            : 'var(--mantine-color-default-hover)'
                        }
                        c={isOwnMessage ? 'white' : undefined}
                      >
                        <Text
                          size="xs"
                          fw={600}
                          className="mb-1"
                          c={isOwnMessage ? 'gray.1' : undefined}
                        >
                          {message.sender}
                        </Text>
                        <Text size="sm" className="whitespace-pre-wrap break-words">
                          {message.message}
                        </Text>
                        <Text size="xs" c={isOwnMessage ? 'gray.3' : 'dimmed'}>
                          {format(new Date(message.created_at), 'MMM d, HH:mm')}
                        </Text>
                      </Box>
                    </div>
                  );
                })}
                {/* Invisible element to scroll to */}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Message Input */}
      <Divider />
      <div className="p-4 shrink-0">
        <div className="flex gap-2">
          <TextInput
            ref={messageInputRef}
            className="flex-1"
            placeholder={t('requests.typeMessage')}
            value={messageText}
            onChange={e => setMessageText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={createMessageMutation.isPending}
          />
          <ActionIcon
            variant="filled"
            size="input-sm"
            onClick={handleSendMessage}
            disabled={!messageText.trim() || createMessageMutation.isPending}
          >
            <Send className="h-4 w-4" />
          </ActionIcon>
        </div>
      </div>
    </>
  );
};

export default BookingConversationPanel;

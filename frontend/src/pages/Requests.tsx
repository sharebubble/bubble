import BookingCounterOfferDialog from '@/components/bookings/BookingCounterOfferDialog';
import BookingEditDialog from '@/components/bookings/BookingEditDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useBooking, useBookings, useUpdateBooking } from '@/hooks/useBookings';
import { useItem } from '@/hooks/useItem';
import { useCreateMessage, useMarkMessageAsRead, useMessages } from '@/hooks/useMessages';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Drawer,
  ScrollArea,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { format } from 'date-fns';
import { Calendar, Clock, Menu, Package, RefreshCw, Send, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const Requests = () => {
  const navigate = useNavigate();
  const { bookingId: bookingIdParam } = useParams<{ bookingId?: string }>();

  // CSP-compliant event handlers
  const handleBookingCardClick = (bookingUuid: string) => {
    navigate(`/requests/${bookingUuid}`, { replace: true });
    setIsMenuOpen(false); // Close menu on selection (mobile)
  };

  const handleSelectBooking = (bookingUuid: string) => {
    navigate(`/requests/${bookingUuid}`, { replace: true });
  };

  const handleRefreshMessages = () => {
    refetchMessages();
  };
  const { t } = useLanguage();
  const { user } = useAuth();
  const { data: bookings, isLoading } = useBookings();
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(bookingIdParam ?? null);
  const { data: selectedBookingDetails } = useBooking(selectedBookingId || undefined);
  const { data: selectedItemDetails } = useItem(selectedBookingDetails?.item_details?.id);
  const [messageText, setMessageText] = useState('');
  const updateBookingMutation = useUpdateBooking();
  const {
    data: messagesData,
    refetch: refetchMessages,
    isFetching: isFetchingMessages,
  } = useMessages(selectedBookingId || undefined);
  const createMessageMutation = useCreateMessage();
  const markMessageAsReadMutation = useMarkMessageAsRead();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const selectedBooking = selectedBookingDetails;
  const messages = useMemo(() => {
    // Sort messages by created_at ascending (oldest first, newest last)
    const messageList = messagesData?.results || [];
    return [...messageList].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messagesData]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const markedAsReadRef = useRef<Set<string>>(new Set());

  // Sync local state when URL param changes (e.g. navigated from Bookings page)
  useEffect(() => {
    if (bookingIdParam) {
      setSelectedBookingId(bookingIdParam);
    }
  }, [bookingIdParam]);

  // Select first booking on load only when no booking is specified in the URL
  useMemo(() => {
    if (bookings?.results && bookings.results.length > 0 && !selectedBookingId) {
      const firstId = bookings.results[0].id!;
      setSelectedBookingId(firstId);
      navigate(`/requests/${firstId}`, { replace: true });
    }
  }, [bookings, selectedBookingId]);

  // Auto-scroll to bottom when messages change or booking selection changes
  // useEffect(() => {
  //   if (messagesEndRef.current) {
  //     messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  //   }
  // }, [messages, selectedBookingId]);

  // Auto-mark unread messages as read when displayed
  useEffect(() => {
    if (!messages || !user) return;

    // Find messages that need to be marked as read:
    // - is_read is false
    // - sender is not the current user
    // - not already marked in this session
    const unreadMessages = messages.filter(
      message =>
        message.is_read === false &&
        message.sender !== user.username &&
        message.id &&
        !markedAsReadRef.current.has(message.id),
    );

    // Mark each unread message as read
    unreadMessages.forEach(message => {
      if (message.id) {
        // Add to marked set immediately to prevent duplicate requests
        markedAsReadRef.current.add(message.id);
        markMessageAsReadMutation.mutate(message.id);
      }
    });
  }, [messages, user, markMessageAsReadMutation]);

  const getStatusBadge = (status?: number) => {
    switch (status) {
      case 1:
        return (
          <Badge variant="light" color="gray">
            {t('requests.status.pending')}
          </Badge>
        );
      case 2:
        return (
          <Badge variant="outline" color="gray">
            {t('requests.status.cancelled')}
          </Badge>
        );
      case 3:
        return <Badge color="green">{t('requests.status.confirmed')}</Badge>;
      case 4:
        return (
          <Badge variant="outline" color="gray">
            {t('requests.status.completed')}
          </Badge>
        );
      case 5:
        return <Badge color="red">{t('requests.status.rejected')}</Badge>;
      default:
        return (
          <Badge variant="light" color="gray">
            {t('requests.status.unknown')}
          </Badge>
        );
    }
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
    if (!messageText.trim() || !selectedBookingId) return;

    try {
      await createMessageMutation.mutateAsync({
        booking: selectedBookingId,
        message: messageText,
      });
      setMessageText('');
      // Keep focus in the message input for quick follow-up messages
      // Use setTimeout to ensure focus happens after React re-render
      setTimeout(() => {
        messageInputRef.current?.focus();
      }, 0);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const renderBookingList = (onCardClick: (bookingUuid: string) => void) => {
    if (!bookings?.results || bookings.results.length === 0) {
      return (
        <Text component="div" c="dimmed" ta="center" className="py-8">
          <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>{t('requests.noBookings')}</p>
        </Text>
      );
    }

    return (
      <div className="space-y-2">
        {bookings.results.map(booking => {
          const isSelected = selectedBookingId === booking.id;
          const itemTitle = booking.item_details?.name || t('requests.unknownItem');
          const itemImage = booking.item_details?.first_image;

          return (
            <Card
              key={booking.id}
              withBorder
              padding="sm"
              bg={isSelected ? 'var(--mantine-color-green-light)' : undefined}
              style={
                isSelected
                  ? { borderColor: 'var(--mantine-color-green-4)', borderWidth: 2 }
                  : undefined
              }
              className={cn(
                'cursor-pointer transition-colors',
                !isSelected && 'hover:bg-[var(--mantine-color-default-hover)]',
              )}
              onClick={() => onCardClick(booking.id!)}
            >
              <div className="flex gap-3">
                {/* Item Thumbnail */}
                <Box
                  className="w-16 h-16 rounded overflow-hidden shrink-0"
                  bg="var(--mantine-color-default-hover)"
                >
                  {itemImage ? (
                    <img src={itemImage} alt={itemTitle} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </Box>

                {/* Booking Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <Text component="span" size="sm" fw={600} className="line-clamp-1">
                      {itemTitle}
                    </Text>
                    <div className="flex items-center gap-1">
                      {booking.unread_messages_count !== null &&
                        booking.unread_messages_count > 0 && (
                          <Badge color="red" size="sm" className="shrink-0">
                            {booking.unread_messages_count}
                          </Badge>
                        )}
                      {getStatusBadge(booking.status)}
                    </div>
                  </div>
                  <Text
                    component="div"
                    size="xs"
                    c="dimmed"
                    className="flex items-center gap-1 mb-1"
                  >
                    <User className="h-3 w-3" />
                    <span className="line-clamp-1">
                      {t('requests.requestFrom')}{' '}
                      {booking.user?.name || booking.user?.username || 'Unknown'}
                    </span>
                  </Text>
                  <Text component="div" size="xs" c="dimmed" className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span className="line-clamp-1">{formatDateTime(booking.created_at)}</span>
                  </Text>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Text c="dimmed">{t('common.loading')}</Text>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 h-[calc(100vh-5rem)]">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 mb-4">
          {/* Mobile Menu Trigger */}
          <ActionIcon
            variant="outline"
            size="lg"
            className="md:hidden"
            onClick={() => setIsMenuOpen(true)}
            aria-label={t('requests.allBookings')}
          >
            <Menu className="h-4 w-4" />
          </ActionIcon>
          <Drawer
            opened={isMenuOpen}
            onClose={() => setIsMenuOpen(false)}
            position="left"
            size="min(90vw, 400px)"
            title={t('requests.allBookings')}
            styles={{
              body: { padding: 0 },
              title: { fontWeight: 600, fontSize: 'var(--mantine-font-size-lg)' },
            }}
          >
            <ScrollArea className="h-[calc(100vh-5rem)]">
              <div className="p-4">{renderBookingList(handleBookingCardClick)}</div>
            </ScrollArea>
          </Drawer>
          <Title order={1}>{t('requests.title')}</Title>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
          {/* Bookings List - Left Side (Desktop Only) */}
          <Card withBorder padding={0} className="hidden md:flex flex-col col-span-1">
            <ScrollArea className="h-full">
              <div className="p-4">
                <Title order={4} className="mb-4">
                  {t('requests.allBookings')}
                </Title>
                {renderBookingList(handleSelectBooking)}
              </div>
            </ScrollArea>
          </Card>

          {/* Booking Details & Messages - Right Side */}
          <Card
            withBorder
            padding={0}
            className="col-span-1 md:col-span-2 flex flex-col h-[calc(100vh-12rem)]"
          >
            {selectedBooking ? (
              <>
                {/* Booking Header */}
                <div className="p-4 border-b shrink-0">
                  <div className="flex items-start gap-4 mb-4">
                    {/* Item Thumbnail */}
                    <a
                      href={`/item/${selectedBooking.item_details?.id || selectedBooking.item}`}
                      className="shrink-0"
                    >
                      <Box
                        className="w-20 h-20 rounded overflow-hidden"
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
                    </a>

                    {/* Item Info */}
                    <div className="flex-1">
                      <a
                        href={`/item/${selectedBooking.item_details?.id || selectedBooking.item}`}
                        className="text-xl font-bold mb-2 hover:underline block"
                      >
                        {selectedBooking.item_details?.name || t('requests.unknownItem')}
                      </a>
                      <div className="space-y-1">
                        <Text component="div" size="sm" className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>
                            {t('requests.requestFrom')}{' '}
                            <span className="font-medium">
                              {selectedBooking.user?.name ||
                                selectedBooking.user?.username ||
                                'Unknown'}
                            </span>
                          </span>
                        </Text>
                        <Text
                          component="div"
                          size="sm"
                          c="dimmed"
                          className="flex items-center gap-2"
                        >
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
                    className="grid grid-cols-3 md:grid-cols-3 gap-4 p-4 rounded-lg"
                  >
                    {/* Original Item Price */}
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
                              )} ${t('time.perHour')}`
                            : formatPrice(
                                selectedItemDetails.price,
                                selectedItemDetails.price_currency,
                              )}
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

                  {/* Action Buttons - For pending bookings */}
                  {selectedBooking.status === 1 && (
                    <div className="flex items-center gap-2 mt-4">
                      <div className="flex gap-2">
                        {/* Check if current user is the booking requester (owner of the booking) */}
                        {user?.username === selectedBooking.user?.username ? (
                          // Booking requester can edit offer and cancel
                          <>
                            {/* Accept counteroffer button for booking requester when counter_offer differs from offer */}
                            {selectedBooking.counter_offer &&
                              selectedBooking.counter_offer !== selectedBooking.offer && (
                                <Button
                                  color="teal"
                                  onClick={async () => {
                                    try {
                                      await updateBookingMutation.mutateAsync({
                                        id: selectedBooking.id,
                                        data: {
                                          offer: selectedBooking.counter_offer,
                                        },
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
                          // Item owner can accept or reject
                          <>
                            <BookingCounterOfferDialog booking={selectedBooking} />

                            <Button
                              color="green"
                              onClick={() => {
                                // Determine if we must warn: offer differs from item price and differs from counter_offer
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
                                        console.error(
                                          'Error accepting booking after warning:',
                                          error,
                                        );
                                      }
                                    },
                                  });
                                  return;
                                }

                                // Otherwise, proceed directly
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
                          onClick={handleRefreshMessages}
                          disabled={!selectedBookingId || isFetchingMessages}
                          aria-label={t('requests.refresh')}
                        >
                          <RefreshCw
                            className={isFetchingMessages ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                          />
                        </ActionIcon>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons - For confirmed or rejected bookings */}
                  {selectedBooking.status === 3 && (
                    <div className="flex items-center gap-2 mt-4">
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

                      <div className="ml-auto">
                        <ActionIcon
                          variant="subtle"
                          size="lg"
                          onClick={handleRefreshMessages}
                          disabled={!selectedBookingId || isFetchingMessages}
                          aria-label={t('requests.refresh')}
                        >
                          <RefreshCw
                            className={isFetchingMessages ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                          />
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
                                className={cn(
                                  'flex',
                                  isOwnMessage ? 'justify-end' : 'justify-start',
                                )}
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
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Text component="div" c="dimmed" ta="center">
                  <Calendar className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p>{t('requests.selectBooking')}</p>
                </Text>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Requests;

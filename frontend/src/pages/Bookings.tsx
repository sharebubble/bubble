import BookingCounterOfferDialog from '@/components/bookings/BookingCounterOfferDialog';
import BookingEditDialog from '@/components/bookings/BookingEditDialog';
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
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useBooking, useBookings, useUpdateBooking } from '@/hooks/useBookings';
import { useItem } from '@/hooks/useItem';
import { useCreateMessage, useMarkMessageAsRead, useMessages } from '@/hooks/useMessages';
import { formatPrice } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Calendar, Clock, Menu, Package, RefreshCw, Send, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const Bookings = () => {
  // CSP-compliant event handlers
  const handleBookingCardClick = (bookingUuid: string) => {
    setSelectedBookingId(bookingUuid);
    setIsMenuOpen(false); // Close menu on selection (mobile)
  };

  const handleSelectBooking = (bookingUuid: string) => {
    setSelectedBookingId(bookingUuid);
  };

  const handleRefreshMessages = () => {
    refetchMessages();
  };
  const { t } = useLanguage();
  const { user } = useAuth();
  const { data: bookings, isLoading } = useBookings();
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const { data: selectedBookingDetails } = useBooking(selectedBookingId || undefined);
  const { data: selectedItemDetails } = useItem(selectedBookingDetails?.item_details?.id);
  const [messageText, setMessageText] = useState('');
  const updateBookingMutation = useUpdateBooking();
  // Dialog state for confirming acceptance when offer differs
  const [showAcceptWarning, setShowAcceptWarning] = useState(false);
  const [pendingAcceptBookingId, setPendingAcceptBookingId] = useState<string | null>(null);
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

  // Select first booking on load
  useMemo(() => {
    if (bookings?.results && bookings.results.length > 0 && !selectedBookingId) {
      setSelectedBookingId(bookings.results[0].id!);
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
        return <Badge variant="secondary">{t('requests.status.pending')}</Badge>;
      case 2:
        return <Badge variant="outline">{t('requests.status.cancelled')}</Badge>;
      case 3:
        return (
          <Badge variant="default" className="bg-green-500">
            {t('requests.status.confirmed')}
          </Badge>
        );
      case 4:
        return <Badge variant="outline">{t('requests.status.completed')}</Badge>;
      case 5:
        return <Badge variant="destructive">{t('requests.status.rejected')}</Badge>;
      default:
        return <Badge variant="secondary">{t('requests.status.unknown')}</Badge>;
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 h-[calc(100vh-5rem)]">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 mb-4">
          {/* Mobile Menu Trigger */}
          <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[90vw] sm:w-[400px] p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle>{t('requests.allBookings')}</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-5rem)]">
                <div className="p-4">
                  {!bookings?.results || bookings.results.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>{t('requests.noBookings')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bookings.results.map(booking => {
                        const isSelected = selectedBookingId === booking.id;
                        const itemTitle = booking.item_details?.name || t('requests.unknownItem');
                        const itemImage = booking.item_details?.first_image;
                        const itemUuid = booking.item_details?.id || booking.item;

                        return (
                          <Card
                            key={booking.id}
                            className={cn(
                              'cursor-pointer transition-colors hover:bg-accent',
                              isSelected && 'bg-accent dark:bg-accent border-green-200 border-2',
                            )}
                            onClick={() => handleBookingCardClick(booking.id!)}
                          >
                            <CardContent className="p-3">
                              <div className="flex gap-3">
                                {/* Item Thumbnail */}
                                <div className="w-16 h-16 rounded overflow-hidden bg-muted">
                                  {itemImage ? (
                                    <img
                                      src={itemImage}
                                      alt={itemTitle}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Package className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                  )}
                                </div>

                                {/* Booking Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start gap-2 mb-1">
                                    <span className="font-semibold text-sm line-clamp-1">
                                      {itemTitle}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      {booking.unread_messages_count !== null &&
                                        booking.unread_messages_count > 0 && (
                                          <Badge
                                            variant="destructive"
                                            className="h-5 min-w-[20px] px-1 text-xs"
                                          >
                                            {booking.unread_messages_count}
                                          </Badge>
                                        )}
                                      {getStatusBadge(booking.status)}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                                    <User className="h-3 w-3" />
                                    <span className="line-clamp-1">
                                      {t('requests.requestFrom')}{' '}
                                      {booking.user?.name || booking.user?.username || 'Unknown'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    <span className="line-clamp-1">
                                      {formatDateTime(booking.created_at)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
          <h1 className="text-3xl font-bold">{t('requests.title')}</h1>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
          {/* Bookings List - Left Side (Desktop Only) */}
          <Card className="hidden md:block col-span-1">
            <ScrollArea className="h-full">
              <div className="p-4">
                <h2 className="text-lg font-semibold mb-4">{t('requests.allBookings')}</h2>
                {!bookings?.results || bookings.results.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{t('requests.noBookings')}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bookings.results.map(booking => {
                      const isSelected = selectedBookingId === booking.id;
                      const itemTitle = booking.item_details?.name || t('requests.unknownItem');
                      const itemImage = booking.item_details?.first_image;
                      const itemUuid = booking.item_details?.id || booking.item;

                      return (
                        <Card
                          key={booking.id}
                          className={cn(
                            'cursor-pointer transition-colors hover:bg-accent',
                            isSelected && 'bg-accent dark:bg-accent border-green-200 border-2',
                          )}
                          onClick={() => handleSelectBooking(booking.id!)}
                        >
                          <CardContent className="p-3">
                            <div className="flex gap-3">
                              {/* Item Thumbnail */}
                              <div className="w-16 h-16 rounded overflow-hidden bg-muted">
                                {itemImage ? (
                                  <img
                                    src={itemImage}
                                    alt={itemTitle}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Package className="h-6 w-6 text-muted-foreground" />
                                  </div>
                                )}
                              </div>

                              {/* Booking Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start gap-2 mb-1">
                                  <span className="font-semibold text-sm line-clamp-1">
                                    {itemTitle}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    {booking.unread_messages_count !== null &&
                                      booking.unread_messages_count > 0 && (
                                        <Badge
                                          variant="destructive"
                                          className="h-5 min-w-[20px] px-1 text-xs"
                                        >
                                          {booking.unread_messages_count}
                                        </Badge>
                                      )}
                                    {getStatusBadge(booking.status)}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                                  <User className="h-3 w-3" />
                                  <span className="line-clamp-1">
                                    {t('requests.requestFrom')}{' '}
                                    {booking.user?.name || booking.user?.username || 'Unknown'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  <span className="line-clamp-1">
                                    {formatDateTime(booking.created_at)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>

          {/* Booking Details & Messages - Right Side */}
          <Card className="col-span-1 md:col-span-2 flex flex-col h-[calc(100vh-12rem)]">
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
                      <div className="w-20 h-20 rounded overflow-hidden bg-muted">
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
                      </div>
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
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>
                            {t('requests.requestFrom')}{' '}
                            <span className="font-medium">
                              {selectedBooking.user?.name ||
                                selectedBooking.user?.username ||
                                'Unknown'}
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span>{formatDateTime(selectedBooking.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">{getStatusBadge(selectedBooking.status)}</div>
                  </div>

                  {/* Booking Details */}
                  <div className="grid grid-cols-3 md:grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                    {/* Original Item Price */}
                    {selectedItemDetails && selectedItemDetails.price && (
                      <div>
                        <p className="text-xs font-medium mb-1">
                          {selectedItemDetails.sales_type === 'rent'
                            ? t('booking.listedRentalPrice')
                            : t('booking.listedPrice')}
                        </p>
                        <p className="text-lg text-muted-foreground">
                          {selectedItemDetails.sales_type === 'rent'
                            ? `${formatPrice(
                                selectedItemDetails.price,
                                selectedItemDetails.price_currency,
                              )} ${t('time.perHour')}`
                            : formatPrice(
                                selectedItemDetails.price,
                                selectedItemDetails.price_currency,
                              )}
                        </p>
                      </div>
                    )}
                    {selectedBooking.offer && (
                      <div>
                        <p className="text-xs mb-1">{t('requests.offerAmount')}</p>
                        <p className="text-lg font-bold">
                          {formatPrice(selectedBooking.offer, 'EUR')}
                        </p>
                      </div>
                    )}
                    {selectedBooking.time_from && selectedBooking.time_to && (
                      <div>
                        <p className="text-sm font-medium mb-1">{t('requests.rentalPeriod')}</p>
                        <p className="text-sm">
                          <Clock className="inline h-3 w-3 mr-1" />
                          {formatDateTime(selectedBooking.time_from)}
                        </p>
                        <p className="text-sm">
                          <Clock className="inline h-3 w-3 mr-1" />
                          {formatDateTime(selectedBooking.time_to)}
                        </p>
                      </div>
                    )}
                    {selectedBooking.counter_offer && (
                      <div>
                        <p className="text-xs font-medium mb-1">{t('requests.counterOffer')}</p>
                        <p className="text-lg font-bold text-orange-500">
                          {formatPrice(selectedBooking.counter_offer, 'EUR')}
                        </p>
                      </div>
                    )}
                  </div>

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
                                  size="sm"
                                  className="bg-emerald-500 hover:bg-emerald-600"
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
                              size="sm"
                              variant="destructive"
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

                            <AlertDialog
                              open={showAcceptWarning}
                              onOpenChange={setShowAcceptWarning}
                            >
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  className="bg-green-500 hover:bg-green-600"
                                  onClick={e => {
                                    // Determine if we must warn: offer differs from item price and differs from counter_offer
                                    const itemPrice = selectedItemDetails?.price;
                                    const offerDiffersFromItem =
                                      !!selectedBooking.offer &&
                                      selectedBooking.offer !== itemPrice;
                                    const offerDiffersFromCounter =
                                      !!selectedBooking.counter_offer &&
                                      selectedBooking.offer !== selectedBooking.counter_offer;

                                    if (offerDiffersFromItem && offerDiffersFromCounter) {
                                      e.preventDefault();
                                      setPendingAcceptBookingId(selectedBooking.id);
                                      setShowAcceptWarning(true);
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
                              </AlertDialogTrigger>

                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t('requests.acceptWarningTitle')}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t('requests.acceptWarningDescription')?.replace(
                                      '{amount}',
                                      String(selectedBooking.offer ?? ''),
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={async () => {
                                      if (!pendingAcceptBookingId) return;
                                      try {
                                        await updateBookingMutation.mutateAsync({
                                          id: pendingAcceptBookingId,
                                          data: { status: 3 },
                                        });
                                      } catch (error) {
                                        console.error(
                                          'Error accepting booking after warning:',
                                          error,
                                        );
                                      } finally {
                                        setShowAcceptWarning(false);
                                        setPendingAcceptBookingId(null);
                                      }
                                    }}
                                  >
                                    {t('requests.accept')}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            <Button
                              size="sm"
                              variant="destructive"
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
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={handleRefreshMessages}
                          disabled={!selectedBookingId || isFetchingMessages}
                          aria-label={t('requests.refresh')}
                        >
                          <RefreshCw
                            className={isFetchingMessages ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                          />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons - For confirmed or rejected bookings */}
                  {selectedBooking.status === 3 && (
                    <div className="flex items-center gap-2 mt-4">
                      <Button
                        size="sm"
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
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={handleRefreshMessages}
                          disabled={!selectedBookingId || isFetchingMessages}
                          aria-label={t('requests.refresh')}
                        >
                          <RefreshCw
                            className={isFetchingMessages ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                          />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Messages Area */}
                <div className="flex-1 flex flex-col min-h-0">
                  <ScrollArea className="flex-1">
                    <div className="space-y-4 p-4">
                      {messages.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <p className="text-sm">{t('requests.noMessages')}</p>
                          <p className="text-xs mt-2">{t('requests.startConversation')}</p>
                        </div>
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
                                <div
                                  className={cn(
                                    'max-w-[70%] rounded-lg p-3 space-y-1',
                                    isOwnMessage
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted',
                                  )}
                                >
                                  <p
                                    className={cn(
                                      'text-xs font-semibold mb-1',
                                      isOwnMessage
                                        ? 'text-primary-foreground/90'
                                        : 'text-foreground',
                                    )}
                                  >
                                    {message.sender}
                                  </p>
                                  <p className="text-sm whitespace-pre-wrap break-words">
                                    {message.message}
                                  </p>
                                  <p
                                    className={cn(
                                      'text-xs',
                                      isOwnMessage
                                        ? 'text-primary-foreground/70'
                                        : 'text-muted-foreground',
                                    )}
                                  >
                                    {format(new Date(message.created_at), 'MMM d, HH:mm')}
                                  </p>
                                </div>
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
                <Separator />
                <div className="p-4 shrink-0">
                  <div className="flex gap-2">
                    <Input
                      ref={messageInputRef}
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
                    <Button
                      size="icon"
                      onClick={handleSendMessage}
                      disabled={!messageText.trim() || createMessageMutation.isPending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Calendar className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p>{t('requests.selectBooking')}</p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Bookings;

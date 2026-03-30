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
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDeleteItem, useMyItems, useUpdateItemStatus } from '@/hooks/useMyItems';
import { getCategoryIcon } from '@/lib/categoryIcons';
import { convertLineBreaks } from '@/lib/convertLineBreaks';
import { formatPrice } from '@/lib/currency';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { SalesTypeEnum, Status402Enum } from '@/services/django';
import { Edit3, Eye, Grid3X3, List, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MyItems = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { data: myItemsData, isLoading } = useMyItems();
  const items = myItemsData?.results || [];
  const updateStatusMutation = useUpdateItemStatus();
  const deleteItemMutation = useDeleteItem();

  // Helper function to get the correct edit URL based on item category
  const getEditUrl = (item: any) => {
    return item.category === 'books' ? `/edit-book/${item.id}` : `/edit-item/${item.id}`;
  };

  // View mode state with localStorage persistence
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');

  useEffect(() => {
    const savedViewMode = localStorage.getItem('myItemsViewMode') as 'list' | 'cards' | null;
    if (savedViewMode) {
      setViewMode(savedViewMode);
    }
  }, []);

  const toggleViewMode = (mode: 'list' | 'cards') => {
    setViewMode(mode);
    localStorage.setItem('myItemsViewMode', mode);
  };

  const handleDeleteItem = (itemId: string) => {
    deleteItemMutation.mutate(itemId);
  };

  const handleStatusChange = async (
    itemId: string,
    newStatus: 'draft' | 'available' | 'reserved' | 'rented' | 'sold',
  ) => {
    // Map string status to Status402Enum number
    let statusEnum: Status402Enum;
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
      default:
        statusEnum = 0;
    }

    updateStatusMutation.mutate({ itemId, status: statusEnum });
  };

  /** Returns the SelectItem options appropriate for the given sales_type. */
  const getStatusOptions = (salesType: SalesTypeEnum | undefined) => {
    const sellDonate = ['sell', 'donate', 'want_buy'];
    const rentBorrow = ['rent', 'borrow', 'want_rent'];
    if (salesType && sellDonate.includes(salesType)) {
      return (
        <>
          <SelectItem value="0">{t('status.draft')}</SelectItem>
          <SelectItem value="2">{t('status.available')}</SelectItem>
          <SelectItem value="3">{t('status.reserved')}</SelectItem>
          <SelectItem value="5">{t('status.sold')}</SelectItem>
        </>
      );
    }
    if (salesType && rentBorrow.includes(salesType)) {
      return (
        <>
          <SelectItem value="0">{t('status.draft')}</SelectItem>
          <SelectItem value="2">{t('status.available')}</SelectItem>
          <SelectItem value="4">{t('status.rented')}</SelectItem>
        </>
      );
    }
    // fallback: all options
    return (
      <>
        <SelectItem value="0">{t('status.draft')}</SelectItem>
        <SelectItem value="2">{t('status.available')}</SelectItem>
        <SelectItem value="3">{t('status.reserved')}</SelectItem>
        <SelectItem value="4">{t('status.rented')}</SelectItem>
        <SelectItem value="5">{t('status.sold')}</SelectItem>
      </>
    );
  };

  const getStatusColor = (status: Status402Enum) => {
    switch (status) {
      case 0:
        return 'bg-muted text-muted-foreground'; // draft
      case 2:
        return 'bg-success text-success-foreground'; // available
      case 3:
        return 'bg-warning text-warning-foreground'; // reserved
      case 4:
        return 'bg-primary text-primary-foreground'; // rented
      case 5:
        return 'bg-destructive text-destructive-foreground'; // sold/gone
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusText = (status: Status402Enum | undefined) => {
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
      default:
        return t('status.unknown');
    }
  };

  const getSalesTypeBadgeColor = (st: SalesTypeEnum | undefined) => {
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

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-foreground">{t('myItems.title')}</h1>
        <div className="flex items-center gap-4">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => toggleViewMode('list')}
              className="h-8 w-8 p-0"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'cards' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => toggleViewMode('cards')}
              className="h-8 w-8 p-0"
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12">
          <div className="max-w-md mx-auto">
            <h3 className="text-xl font-semibold text-foreground mb-2">{t('myItems.noItems')}</h3>
            <p className="text-muted-foreground mb-6">{t('myItems.createFirst')}</p>
            <Button onClick={() => navigate('/create-item')} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('myItems.shareItem')}
            </Button>
          </div>
        </div>
      ) : viewMode === 'list' ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Image</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => {
                const primaryImage = item.first_image;

                return (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(getEditUrl(item))}
                  >
                    <TableCell>
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
                    </TableCell>
                    <TableCell>
                      <div className="font-medium max-w-48 truncate">{item.name}</div>
                      {item.description && (
                        <div className="text-sm text-muted-foreground truncate max-w-48">
                          {item.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Select
                        value={item.status?.toString()}
                        onValueChange={value => {
                          const statusMap: Record<
                            string,
                            'draft' | 'available' | 'reserved' | 'rented' | 'sold'
                          > = {
                            '0': 'draft',
                            '2': 'available',
                            '3': 'reserved',
                            '4': 'rented',
                            '5': 'sold',
                          };
                          handleStatusChange(item.id, statusMap[value] || 'draft');
                        }}
                        disabled={updateStatusMutation.isPending}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getStatusOptions(item.sales_type as SalesTypeEnum | undefined)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="text-xs">
                          {t(`categories.${item.category}`)}
                        </Badge>
                        {item.sales_type && (
                          <Badge
                            className={cn(
                              getSalesTypeBadgeColor(item.sales_type as SalesTypeEnum),
                              'text-xs',
                            )}
                          >
                            {t(`item.salesType.badge.${item.sales_type}`)}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {item.price && (
                          <div className="flex items-center gap-1">
                            {formatPrice(item.price, item.price_currency)}
                            {item.sales_type === 'rent' && (
                              <span className="text-xs text-muted-foreground">
                                {t('time.perHour')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(item.created_at, language)}
                      </div>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/item/${item.id}`)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(getEditUrl(item))}>
                            <Edit3 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={e => e.preventDefault()}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This action cannot be undone. This will permanently delete your
                                  item and remove its data from our servers.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(item => {
            return (
              <Card key={item.id} className="overflow-hidden">
                {/* Image */}
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

                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <h3
                      className="font-semibold text-foreground line-clamp-1 cursor-pointer hover:underline"
                      onClick={() => navigate(getEditUrl(item))}
                    >
                      {item.name}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/item/${item.id}`)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(getEditUrl(item))}>
                          <Edit3 className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              onSelect={e => e.preventDefault()}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete your item
                                and remove its data from our servers.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteItem(item.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge
                      className={cn(
                        item.status !== undefined && getStatusColor(item.status),
                        'text-xs',
                      )}
                    >
                      {getStatusText(item.status)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {t(`categories.${item.category}`)}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="pb-3">
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {item.description !== undefined && convertLineBreaks(item.description)}
                  </p>

                  {/* Price */}
                  <div className="text-lg font-semibold text-primary">
                    <div className="text-sm space-y-1">
                      {item.price && (
                        <div className="flex items-center gap-1">
                          {formatPrice(item.price, item.price_currency)}
                          {item.sales_type === 'rent' && (
                            <span className="text-xs font-normal text-muted-foreground">
                              {t('time.perHour')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {item.sales_type && (
                    <Badge
                      className={cn(
                        getSalesTypeBadgeColor(item.sales_type as SalesTypeEnum),
                        'text-xs mt-1',
                      )}
                    >
                      {t(`item.salesType.badge.${item.sales_type}`)}
                    </Badge>
                  )}
                </CardContent>

                <CardFooter className="pt-0">
                  <div className="w-full space-y-2">
                    <div className="text-xs text-muted-foreground">{t('myItems.status')}</div>
                    <Select
                      value={item.status !== undefined ? item.status.toString() : undefined}
                      onValueChange={value => {
                        const statusMap: Record<
                          string,
                          'draft' | 'available' | 'reserved' | 'rented' | 'sold'
                        > = {
                          '0': 'draft',
                          '2': 'available',
                          '3': 'reserved',
                          '4': 'rented',
                          '5': 'sold',
                        };
                        handleStatusChange(item.id, statusMap[value] || 'draft');
                      }}
                      disabled={updateStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {getStatusOptions(item.sales_type as SalesTypeEnum | undefined)}
                      </SelectContent>
                    </Select>
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyItems;

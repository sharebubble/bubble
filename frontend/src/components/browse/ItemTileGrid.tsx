import { ItemCard } from '@/components/browse/ItemCard';
import { type ItemList } from '@/services/django';

type ItemTileGridProps = {
  items: ItemList[];
};

/**
 * Compact grid of item tiles used by the start page rows.
 *
 * Narrower than {@link CardsView}'s catalogue grid — two tiles per row on a
 * phone, three from `md` up — so a row stays a row instead of turning into a
 * second catalogue.
 */
export const ItemTileGrid = ({ items }: ItemTileGridProps) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
    {items.map(item => (
      <ItemCard
        key={item.id}
        id={item.id}
        title={item.name}
        description={item.description || ''}
        category={item.category}
        condition={item.condition === 0 ? 'new' : item.condition === 1 ? 'used' : 'broken'}
        status={item.status}
        salesType={item.sales_type}
        price={item.price ? parseFloat(item.price) : undefined}
        priceCurrency={item.price_currency}
        location="Location not set"
        imageUrl={item.first_image || undefined}
        owner={item.user}
        createdAt={item.created_at}
        rentalOpenEnd={item.rental_open_end ?? false}
        rentalSelfService={item.rental_self_service ?? false}
      />
    ))}
  </div>
);

import { ItemCard } from '@/components/browse/ItemCard';
import { type ItemList } from '@/services/django';

type CardsViewProps = {
  items: ItemList[];
};

export const CardsView = ({ items }: CardsViewProps) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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
        rentalPeriod={item.rental_period}
        location="Location not set"
        imageUrl={item.first_image || undefined}
        owner={item.user}
        createdAt={item.created_at}
        isFavorited={false}
        rentalOpenEnd={item.rental_open_end ?? false}
        rentalSelfService={item.rental_self_service ?? false}
      />
    ))}
  </div>
);

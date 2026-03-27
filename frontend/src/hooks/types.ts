import { type PublicItemsListData } from '@/services/django';

export type ItemCategory = NonNullable<NonNullable<PublicItemsListData['query']>['category']>;
export type ItemCategoryFilter = ItemCategory | 'all';

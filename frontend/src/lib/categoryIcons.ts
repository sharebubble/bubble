import { type ItemCategoryFilter } from '@/hooks/types';
import {
  BookOpen,
  Car,
  ChefHat,
  Dumbbell,
  Flower2,
  Gamepad2,
  Grid3x3,
  MoreHorizontal,
  Shirt,
  Smartphone,
  Sofa,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type CategoryConfig = {
  id: ItemCategoryFilter;
  icon: LucideIcon;
};

export const categories: CategoryConfig[] = [
  { id: 'all', icon: Grid3x3 },
  { id: 'electronics', icon: Smartphone },
  { id: 'tools', icon: Wrench },
  { id: 'furniture', icon: Sofa },
  { id: 'books', icon: BookOpen },
  { id: 'sports', icon: Dumbbell },
  { id: 'clothing', icon: Shirt },
  { id: 'kitchen', icon: ChefHat },
  { id: 'garden', icon: Flower2 },
  { id: 'toys', icon: Gamepad2 },
  { id: 'vehicles', icon: Car },
  { id: 'rooms', icon: Sofa },
  { id: 'other', icon: MoreHorizontal },
];

export const categoryTranslationKeys = {
  all: 'categories.all',
  electronics: 'categories.electronics',
  tools: 'categories.tools',
  furniture: 'categories.furniture',
  books: 'categories.books',
  sports: 'categories.sports',
  clothing: 'categories.clothing',
  kitchen: 'categories.kitchen',
  garden: 'categories.garden',
  toys: 'categories.toys',
  vehicles: 'categories.vehicles',
  rooms: 'categories.rooms',
  other: 'categories.other',
} satisfies Record<ItemCategoryFilter, string>;

export function getCategoryIcon(categoryId: string | undefined): LucideIcon {
  const category = categories.find(c => c.id === categoryId);
  return category?.icon ?? MoreHorizontal;
}

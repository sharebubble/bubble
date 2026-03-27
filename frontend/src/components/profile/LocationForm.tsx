import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useCreateLocation, useUpdateLocation } from '@/hooks/useUserLocations';
import { Loader2 } from 'lucide-react';

const locationSchema = z.object({
  name: z.string().min(1, 'Location name is required'),
  address: z.string().min(1, 'Address is required'),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  is_default: z.boolean(),
});

type LocationFormData = z.infer<typeof locationSchema>;

interface LocationFormProps {
  location?: {
    id: string;
    name: string;
    address: string;
    latitude?: number | null;
    longitude?: number | null;
    is_default?: boolean;
  };
  onSuccess?: () => void;
}

export const LocationForm = ({ location, onSuccess }: LocationFormProps) => {
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();
  const isEditing = !!location;

  const form = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: location?.name || '',
      address: location?.address || '',
      latitude: location?.latitude || undefined,
      longitude: location?.longitude || undefined,
      is_default: location?.is_default || false,
    },
  });

  const onSubmit = (data: LocationFormData) => {
    // Ensure required fields are present
    const locationData = {
      name: data.name,
      address: data.address,
      latitude: data.latitude,
      longitude: data.longitude,
      is_default: data.is_default,
    };

    if (isEditing) {
      updateLocation.mutate({ locationId: location.id, updates: locationData }, { onSuccess });
    } else {
      createLocation.mutate(locationData, { onSuccess });
    }
  };

  const isPending = createLocation.isPending || updateLocation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Home, Office, Warehouse" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input placeholder="Full address" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="latitude"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Latitude (Optional)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0.000000"
                    {...field}
                    onChange={e =>
                      field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="longitude"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Longitude (Optional)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0.000000"
                    {...field}
                    onChange={e =>
                      field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="is_default"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Default Location</FormLabel>
                <div className="text-sm text-muted-foreground">
                  Set this as your default location for new items
                </div>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEditing ? 'Update Location' : 'Add Location'}
        </Button>
      </form>
    </Form>
  );
};

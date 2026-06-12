import { Button, Paper, Switch, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { z } from 'zod';
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
    validate: zod4Resolver(locationSchema),
    initialValues: {
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
    <form onSubmit={form.onSubmit(onSubmit)} className="space-y-4">
      <TextInput
        label="Location Name"
        placeholder="e.g., Home, Office, Warehouse"
        {...form.getInputProps('name')}
      />

      <TextInput label="Address" placeholder="Full address" {...form.getInputProps('address')} />

      <div className="grid grid-cols-2 gap-4">
        <TextInput
          type="number"
          step="any"
          label="Latitude (Optional)"
          placeholder="0.000000"
          {...form.getInputProps('latitude')}
          value={form.getValues().latitude ?? ''}
          onChange={e =>
            form.setFieldValue('latitude', e.target.value ? parseFloat(e.target.value) : undefined)
          }
        />

        <TextInput
          type="number"
          step="any"
          label="Longitude (Optional)"
          placeholder="0.000000"
          {...form.getInputProps('longitude')}
          value={form.getValues().longitude ?? ''}
          onChange={e =>
            form.setFieldValue('longitude', e.target.value ? parseFloat(e.target.value) : undefined)
          }
        />
      </div>

      <Paper withBorder radius="lg" p="md" className="flex flex-row items-center justify-between">
        <div className="space-y-0.5">
          <Text fw={500}>Default Location</Text>
          <Text size="sm" c="dimmed">
            Set this as your default location for new items
          </Text>
        </div>
        <Switch {...form.getInputProps('is_default', { type: 'checkbox' })} />
      </Paper>

      <Button
        type="submit"
        disabled={isPending}
        fullWidth
        leftSection={isPending ? <Loader2 size={16} className="animate-spin" /> : undefined}
      >
        {isEditing ? 'Update Location' : 'Add Location'}
      </Button>
    </form>
  );
};

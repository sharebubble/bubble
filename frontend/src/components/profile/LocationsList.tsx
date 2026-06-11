import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, Modal, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { useUserLocations, useDeleteLocation } from '@/hooks/useUserLocations';
import { LocationForm } from './LocationForm';
import { MapPin, Plus, Edit2, Trash2, Loader2 } from 'lucide-react';

type UserLocation = {
  id: string;
  name: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default?: boolean;
};

export const LocationsList = () => {
  const { data: locations, isLoading } = useUserLocations();
  const deleteLocation = useDeleteLocation();
  const [editingLocation, setEditingLocation] = useState<UserLocation | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleEdit = (location: UserLocation) => {
    setEditingLocation(location);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (locationId: string) => {
    deleteLocation.mutate(locationId);
  };

  const openDeleteConfirm = (location: UserLocation) => {
    modals.openConfirmModal({
      title: 'Delete Location',
      children: (
        <Text size="sm">
          Are you sure you want to delete "{location.name}"? This action cannot be undone.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => handleDelete(location.id),
    });
  };

  const handleEditSuccess = () => {
    setIsEditDialogOpen(false);
    setEditingLocation(null);
  };

  const handleAddSuccess = () => {
    setIsAddDialogOpen(false);
  };

  if (isLoading) {
    return (
      <Card withBorder padding="lg">
        <div className="flex justify-center items-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Card>
    );
  }

  return (
    <Card withBorder padding="lg">
      <div className="flex flex-row items-center justify-between mb-4">
        <Title order={3} className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Locations
        </Title>
        <Button size="sm" leftSection={<Plus size={16} />} onClick={() => setIsAddDialogOpen(true)}>
          Add Location
        </Button>
      </div>

      <Modal
        opened={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        title="Add New Location"
      >
        <LocationForm onSuccess={handleAddSuccess} />
      </Modal>

      {!locations || locations.length === 0 ? (
        <div className="text-center py-8">
          <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <Text c="dimmed">No locations added yet</Text>
          <Text size="sm" c="dimmed">
            Add a location to get started
          </Text>
        </div>
      ) : (
        <div className="space-y-4">
          {locations.map(location => (
            <div
              key={location.id}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Text fw={500} component="h3">
                    {location.name}
                  </Text>
                  {location.is_default && <Badge variant="light">Default</Badge>}
                </div>
                <Text size="sm" c="dimmed">
                  {location.address}
                </Text>
                {location.latitude && location.longitude && (
                  <Text size="xs" c="dimmed" className="mt-1">
                    {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                  </Text>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ActionIcon
                  variant="outline"
                  size="lg"
                  aria-label="Edit location"
                  onClick={() => handleEdit(location)}
                >
                  <Edit2 size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="outline"
                  size="lg"
                  aria-label="Delete location"
                  onClick={() => openDeleteConfirm(location)}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        opened={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        title="Edit Location"
      >
        {editingLocation && <LocationForm location={editingLocation} onSuccess={handleEditSuccess} />}
      </Modal>
    </Card>
  );
};

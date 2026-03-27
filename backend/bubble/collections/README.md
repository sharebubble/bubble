# Collections App

This Django app provides functionality for creating and managing collections of items with granular object-level permissions.

## Features

- **Collection Management**: Create, read, update, and delete collections
- **Item Management**: Add and remove items from collections
- **Object-Level Permissions**: Grant view/change/add/remove permissions to specific users or groups
- **Ownership**: Creator automatically becomes the owner with full permissions
- **REST API**: Full API support for frontend integration
- **Bulk Operations**: Bulk add/remove items from collections
- **History Tracking**: Track changes to collections using a custom `CollectionEvent` audit log model

## Models

### Collection

Represents a collection of items owned by a user.

**Fields:**

- `id`: UUID primary key
- `name`: Collection name (max 200 characters)
- `description`: Optional description
- `owner`: ForeignKey to User (creator/owner)
- `items`: ManyToManyField to Item (through CollectionItem)
- `created_at`: Auto-generated timestamp
- `updated_at`: Auto-updated timestamp

**Permissions:**

- `view_collection`: Can view the collection
- `change_collection`: Can edit collection details
- `delete_collection`: Can delete the collection
- `add_items`: Can add items to the collection
- `remove_items`: Can remove items from the collection

### CollectionItem

Through model for Collection-Item relationship with additional metadata.

**Fields:**

- `id`: UUID primary key
- `collection`: ForeignKey to Collection
- `item`: ForeignKey to Item
- `added_at`: Timestamp when item was added
- `added_by`: User who added the item
- `note`: Optional note about the item
- `ordering`: Integer for custom ordering

## API Endpoints

### Collections

- `GET /api/collections/` - List all collections user has permission to view
- `POST /api/collections/` - Create a new collection
- `GET /api/collections/{id}/` - Retrieve a specific collection
- `PUT /api/collections/{id}/` - Update a collection
- `PATCH /api/collections/{id}/` - Partial update a collection
- `DELETE /api/collections/{id}/` - Delete a collection
- `GET /api/collections/my-collections/` - Get all collections owned by current user

### Collection Item Management

- `POST /api/collections/{id}/add-item/` - Add a single item to collection

  ```json
  {
    "item_id": "uuid",
    "note": "optional note",
    "ordering": 0
  }
  ```

- `POST /api/collections/{id}/bulk-add-items/` - Add multiple items

  ```json
  {
    "item_ids": ["uuid1", "uuid2", "uuid3"]
  }
  ```

- `POST /api/collections/{id}/remove-item/{item_id}/` - Remove a single item
- `POST /api/collections/{id}/bulk-remove-items/` - Remove multiple items
  ```json
  {
    "item_ids": ["uuid1", "uuid2"]
  }
  ```

### Permission Management

- `POST /api/collections/{id}/manage_permissions/` - Grant or revoke permissions (owner only)
  ```json
  {
    "user_id": 123, // OR "group_id": 456
    "permission": "view_collection", // or "change_collection", "add_items", "remove_items"
    "action": "grant" // or "revoke"
  }
  ```

### Collection Items

- `GET /api/collection-items/` - List all collection items user can view
- `POST /api/collection-items/` - Add an item to a collection
- `GET /api/collection-items/{id}/` - Retrieve a specific collection item
- `PUT /api/collection-items/{id}/` - Update collection item
- `PATCH /api/collection-items/{id}/` - Partial update
- `DELETE /api/collection-items/{id}/` - Remove item from collection

## Usage Examples

### Creating a Collection

```python
# Via API
POST /api/collections/
{
  "name": "My Favorite Books",
  "description": "Books I want to share with friends"
}
```

### Granting Permissions

```python
# Grant view permission to a user
POST /api/collections/{id}/manage_permissions/
{
  "user_id": 42,
  "permission": "view_collection",
  "action": "grant"
}

# Grant add_items permission to a group
POST /api/collections/{id}/manage_permissions/
{
  "group_id": 5,
  "permission": "add_items",
  "action": "grant"
}
```

### Adding Items to Collection

```python
# Add single item
POST /api/collections/{id}/add-item/
{
  "item_id": "550e8400-e29b-41d4-a716-446655440000",
  "note": "Great book!",
  "ordering": 1
}

# Bulk add items
POST /api/collections/{id}/bulk-add-items/
{
  "item_ids": [
    "550e8400-e29b-41d4-a716-446655440001",
    "550e8400-e29b-41d4-a716-446655440002"
  ]
}
```

## Permissions System

The app uses **django-guardian** for object-level permissions:

1. **Owner**: Collection creator gets all permissions automatically
2. **User-Level**: Permissions can be granted to specific users
3. **Group-Level**: Permissions can be granted to groups
4. **Fine-Grained**: Separate permissions for viewing, editing, adding items, and removing items

### Permission Hierarchy

- `view_collection`: Required to see the collection
- `change_collection`: Required to edit collection name/description
- `add_items`: Required to add items to the collection
- `remove_items`: Required to remove items from the collection
- `delete_collection`: Required to delete the entire collection (owner only by default)

## Installation & Setup

1. The app is already registered in `INSTALLED_APPS` in `config/settings/base.py`
2. API routes are registered in `config/api_router.py`
3. Run migrations to create database tables:

```bash
# Using Docker
just manage makemigrations collections
just manage migrate

# Or directly
python manage.py makemigrations collections
python manage.py migrate
```

## Admin Interface

The app provides a Django admin interface with:

- Collection management with inline CollectionItem editing
- Search and filtering capabilities
- User and item autocomplete fields
- Permission management through django-guardian admin

## Future Enhancements

Potential improvements for future development:

- [ ] Collection sharing via shareable links
- [ ] Collection templates
- [ ] Collection visibility settings (public/private/internal)
- [ ] Collection tags/categories
- [ ] Collection statistics (views, shares, etc.)
- [ ] Collaborative editing with real-time updates
- [ ] Export collections (PDF, CSV, etc.)
- [ ] Collection comments/discussions

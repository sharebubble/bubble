# Bubble Project

Bubble is a localized item-sharing and rental platform with a focus on community building, semantic search, and AI-assisted item management. It allows users to list items for sale or rent, manage bookings, and maintains a specialized catalog for books.

## Project Structure

### Backend (Django)

Located in `backend/`. Uses Django REST Framework (DRF) for the API.

- `bubble/items/`: Core item logic. Includes AI descriptors, image generation, and `pgvector` for semantic search.
- `bubble/books/`: Specialized items extending the base Item model with ISBN and metadata.
- `bubble/bookings/`: Handles the lifecycle of rentals, offers, and counter-offers. Includes PostgreSQL exclusion constraints for preventing overlapping bookings.
- `bubble/users/`: Custom User model and Profiles.
- `bubble/core/`: Shared components, including WebSockets (`channels`) for real-time notifications.
- `config/`: Project-wide settings (base, local, production, test) and ASGI/WSGI/Celery configuration.

### Frontend (React)

Located in `frontend/`. Built with Vite, TypeScript, and Tailwind CSS.

- `src/services/django/`: Auto-generated SDK based on the backend OpenAPI schema.
- `src/hooks/`: React Query hooks for data fetching (e.g., `useItems`, `useBookings`).
- `src/contexts/`: Global state management (e.g., `LanguageContext`).
- `src/pages/`: Main application views.

To update types after backend changes, run `npm run types:openapi` to regenerate the SDK.

## Technology Stack

- **Backend:** Python 3.12+, Django 5.x, Django Rest Framework, Channels (WebSockets), Celery (Background Tasks).
- **Database:** PostgreSQL with `pgvector` for semantic similarity search.
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Lucide React (Icons).
- **AI/ML:** Integration with Gemini/Google AI for image analysis and prompt-based image generation.
- **DevOps:** Docker Compose, Justfile for command automation.

## Coding Standards & Conventions

### Backend

- Use **UUIDs** for primary keys across all models.
- **Permissions:** Use `django-guardian` for object-level permissions. Ensure `get_for_user` manager methods are used in ViewSets.
- **History:** Enable `simple-history` for critical models (`Item`, `Book`, `Booking`).
- **Translations:** Use `gettext_lazy` (`_`) for all user-facing strings in models and views.
- **Linter:** Follow Ruff configuration (defined in `pyproject.toml` or `setup.cfg`).

### Frontend

- **API Access:** Always use the generated SDK in `src/services/django/`. Do not write raw fetch calls for backend endpoints.
- **Styling:** Use Tailwind CSS utility classes. Prefer components from `src/components/ui/` (likely Shadcn UI based).
- **Hooks:** Business logic should reside in custom hooks under `src/hooks/`.
- **Absolute Imports:** Use `@/` prefix for imports within the `src` directory.

## Common Commands

- `just up`: Start development environment (Docker).
- `just manage <cmd>`: Run Django management commands (e.g., `just manage migrate`).
- `just logs backend`: View backend logs.
- `npm run dev`: Run frontend development server (locally, if not using Docker).
- `npm run generate-api`: Update the frontend SDK after backend schema changes.

# Mantine Migration Plan

> **Status (June 2026): implemented.** All phases below landed on the
> `migrate-to-mantine` branch; `src/components/ui/` and all `@radix-ui`
> packages are gone. Kept beyond the original teardown list: `clsx` +
> `tailwind-merge` (the `cn()` helper is still used for layout classes),
> `tailwindcss-animate` (fade animations), `embla-carousel-react` (peer
> dependency of `@mantine/carousel`), and `date-fns` (date math). The
> `.dark`-class mirror (`ColorSchemeSync`) also stays while Tailwind
> `dark:` utilities remain in layout code.

Plan for completing the migration of the frontend from shadcn/ui (Radix +
Tailwind variants) to [Mantine](https://mantine.dev) as the primary UI library.

## Current state (June 2026)

The migration is already bootstrapped:

- `@mantine/core`, `@mantine/hooks`, `@mantine/notifications` (v8) are installed.
- `MantineProvider` wraps the app in `App.tsx` with a custom theme
  (`src/theme/mantine.ts`) that defines the `bubbleGreen` primary palette and
  mirrors the Tailwind breakpoints.
- `src/components/browse/BrowseNav.tsx` and `CategoryFilter.tsx` already use
  Mantine components.
- `AGENTS.md` codifies the policy: new UI work uses Mantine, Tailwind utilities
  stay for layout/spacing, and touched shadcn surfaces get migrated rather than
  extended.

Everything else still runs on the shadcn stack: 49 wrapper files in
`src/components/ui/`, ~25 `@radix-ui/*` packages, `sonner` + a custom
`use-toast` for notifications, `react-hook-form` + zod for two forms,
`react-day-picker` for the rental calendar, and a hand-rolled
`ThemeProvider` that toggles a `.dark` class for Tailwind.

Actual shadcn usage outside `src/components/ui/` (import counts):

| Heavy use (10+) | Moderate (3–9) | Light (1–2) |
|---|---|---|
| button (36), input (17), badge (15), label (12), card (12) | dialog (9), alert-dialog (7), tooltip (5), dropdown-menu (5), separator (4), textarea, table, select, scroll-area, popover (3 each) | toast, tabs, sheet, progress, form, checkbox, toggle-group, toggle, switch, skeleton, collapsible, calendar, avatar, sonner/toaster |

**Never imported (dead code):** accordion, alert, aspect-ratio, breadcrumb,
carousel, chart, command, context-menu, drawer, hover-card, input-otp,
menubar, navigation-menu, pagination, radio-group, sidebar, slider.

## Guiding principles

1. **Migrate per page/feature, not per component.** Both libraries coexist
   cleanly under one provider tree; replacing whole surfaces avoids
   half-translated wrappers and keeps each PR shippable and visually reviewable.
2. **Replace at call sites — do not build Mantine look-alikes of the shadcn
   wrappers.** Use Mantine components and props directly (as BrowseNav already
   does).
3. **Keep Tailwind for layout/spacing** (flex/grid/padding) per `AGENTS.md`;
   move colors, typography, radii, and component styling to the Mantine theme
   so dark mode and branding have one source of truth.
4. **Keep `lucide-react`** for icons; Mantine is icon-agnostic.
5. Each phase must pass `npm run typecheck`, `lint`, and `build`, plus a manual
   smoke test of the touched pages in light and dark mode.

## Component mapping

| shadcn/Radix | Mantine replacement |
|---|---|
| Button | `Button` / `ActionIcon` (icon-only buttons) |
| Input / Textarea / Label | `TextInput` / `Textarea` (labels are built into Mantine inputs — most `Label` usages disappear) |
| Badge | `Badge` |
| Card | `Card` or `Paper` |
| Dialog | `Modal` |
| AlertDialog | `@mantine/modals` `modals.openConfirmModal` |
| DropdownMenu | `Menu` |
| Tooltip | `Tooltip` (no provider needed) |
| Select | `Select` / `NativeSelect` |
| Popover | `Popover` |
| Tabs | `Tabs` |
| Sheet | `Drawer` |
| Separator | `Divider` |
| Table | `Table` |
| ScrollArea | `ScrollArea` |
| Progress | `Progress` |
| Checkbox / Switch / Toggle / ToggleGroup | `Checkbox` / `Switch` / `Chip` / `SegmentedControl` or `Chip.Group` |
| Skeleton | `Skeleton` |
| Avatar | `Avatar` |
| Collapsible | `Collapse` |
| Calendar (react-day-picker) | `@mantine/dates` `DatePicker` / `Calendar` |
| toast / sonner / use-toast | `@mantine/notifications` `notifications.show()` |
| form (react-hook-form wrapper) | `@mantine/form` `useForm` + `zod4Resolver` (only 2 forms use RHF) |
| embla carousel (ItemDetail images) | `@mantine/carousel` (embla-based, same UX) |

New packages: `@mantine/dates` + `dayjs`, `@mantine/modals`, `@mantine/form` +
`mantine-form-zod-resolver`, `@mantine/carousel`.

## Phases

### Phase 1 — Foundation cleanup (no visual changes)

1. **Delete dead code:** remove the 17 never-imported files from
   `src/components/ui/` and uninstall their now-orphaned dependencies:
   `cmdk`, `vaul`, `recharts`, `input-otp`, and the matching `@radix-ui/*`
   packages (accordion, aspect-ratio, context-menu, hover-card, menubar,
   navigation-menu, progress→keep until Progress migrates, radio-group,
   slider, …). Verify each with a grep before removal.
2. **Unify color-scheme management.** Replace the hand-rolled `ThemeProvider`
   with Mantine's color scheme: `localStorageColorSchemeManager({ key:
   'bubble-theme' })` on `MantineProvider`, and a small effect/hook that mirrors
   the resolved scheme onto the `.dark` class on `<html>` so existing Tailwind
   `dark:` styles keep working until the last phase. Theme toggles switch to
   `useMantineColorScheme()`.
3. **Switch notifications.** Mount `<Notifications />`, add
   `@mantine/notifications/styles.css`, and rewrite `src/hooks/use-toast.ts` as
   a thin adapter over `notifications.show()` so the ~12 call sites
   (hooks, NotificationProvider, pages) migrate without touching every file.
   Drop `sonner`, `next-themes`, `ui/toast*`, `ui/sonner`, `ui/toaster`.
   Follow up by inlining `notifications.show()` at call sites as pages migrate.

### Phase 2 — Simple pages (build conventions)

Migrate in ascending complexity; each is one PR:

1. `NotFound.tsx`, `Auth.tsx` (Button, Input, Card → Mantine; keep
   `login-with-social-button` but re-style it on Mantine `Button`)
2. `Profile.tsx` + `ProfileForm.tsx` + `LocationForm.tsx` — also moves the two
   `react-hook-form` forms to `@mantine/form` + zod resolver, after which
   `react-hook-form`, `@hookform/resolvers`, and `ui/form.tsx` can go.
3. `Collections.tsx` + `CollectionDetail.tsx` + `components/collections/`
4. `Bookings.tsx` + `components/bookings/`

### Phase 3 — Core browse & item surfaces

5. `Index.tsx` + remaining `components/browse/` (finishes the surface already
   started with BrowseNav/CategoryFilter)
6. `ItemDetail.tsx` (Modal, Carousel via `@mantine/carousel`) +
   `BookingDialog.tsx`
7. `MyItems.tsx` + `components/users/`
8. `Requests.tsx` (largest page using Sheet → `Drawer`, tabs, tables)
9. `Header.tsx` + layout (Menu, Drawer for mobile nav)

### Phase 4 — Item editing (highest risk, do last)

10. `CreateItem.tsx` / `EditItem.tsx` / `EditBook.tsx` with
    `ItemFormFields.tsx`, `ImageManager.tsx`, `ImageUploadStep.tsx`,
    `AccessManager.tsx`, `BarcodeScanner.tsx` (~3,800 lines combined).
11. `RentalCalendar.tsx` + `DateHourPicker.tsx`: replace `react-day-picker`
    with `@mantine/dates` (`DatePicker` with custom day rendering for
    availability). This is the most behavior-sensitive piece — budget time for
    manual testing of booking ranges, disabled dates, and timezones
    (`date-fns` can stay or be swapped for the `dayjs` dependency Mantine
    dates already brings in).

### Phase 5 — Teardown

12. Delete the rest of `src/components/ui/`, all remaining `@radix-ui/*`
    packages, `class-variance-authority`, `tailwind-merge`,
    `tailwindcss-animate`, `react-day-picker`, `embla-carousel-react`.
13. Prune `index.css`: drop the shadcn HSL design-token block and `dark:`
    variant plumbing; keep Tailwind itself for layout utilities (per
    `AGENTS.md`). Remove the `.dark`-class mirror from Phase 1 if no `dark:`
    utilities remain.
14. Consolidate remaining visual constants into `src/theme/mantine.ts`
    (extend component default props, e.g. `Button` radius, `Card` shadow) and
    update `AGENTS.md` to drop the transition-period wording. Rename the
    `package.json` `name` field from `vite_react_shadcn_ts` while at it.

## Risks & mitigations

- **Dual dark-mode systems drifting apart** — addressed first (Phase 1.2) so
  one toggle drives both during the whole transition.
- **Visual regressions** — page-scoped PRs with before/after screenshots;
  Mantine theme already matches brand colors and breakpoints.
- **Portal/z-index clashes** while Radix and Mantine overlays coexist — rare,
  but if a Mantine `Modal` ever opens over a Radix popover, set `zIndex` via
  the Mantine theme rather than patching Radix.
- **Bundle size temporarily grows** while both libraries ship; Phase 1 dead-code
  removal offsets most of it, and Phase 5 ends well below the starting point
  (~25 Radix packages + sonner + cva removed vs. 4 small Mantine add-ons).
- **RentalCalendar behavior** — highest functional risk; isolated in its own
  step with explicit manual test cases before merging.

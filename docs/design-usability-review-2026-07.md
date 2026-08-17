# Design & Usability Review — July 2026

A structured review of Bubble's user journeys, UX and visual design on **desktop (1440×900)** and **mobile (390×844)**, with a prioritized improvement plan.

**How this review was done.** The public demo (`demo.sharebubble.org`) was not reachable from the review environment, so the review ran against a locally built instance of this exact codebase (backend + frontend from this repo), seeded with realistic community data (16 items across categories/sales types, 3 users, bookings with message threads, 2 collections). Every journey was exercised in Chromium at both viewports: login → browse → search/filter → item detail → booking → requests (accept/reject surface) → my items → collections → profile → dark mode → 404. Findings were cross-checked against the frontend source (file references below).

**Overall impression.** The product has a solid foundation: a friendly green identity, URL-driven shareable filters with live facet counts, per-field autosave on forms, an accessible image carousel, working dark mode, and a genuinely useful AI-assisted listing flow. The biggest gaps are (1) mobile information architecture, (2) a confusing dual-path booking flow, (3) privacy leaks on the item page, and (4) consistency (loading states, i18n, keyboard access).

Priorities: **P0** = blocks or seriously hurts a core journey · **P1** = high-impact friction · **P2** = medium improvements · **P3** = polish.

---

## P0 — Core journey blockers

### 1. Mobile navigation: primary sections are hidden behind the avatar menu
`frontend/src/components/layout/Header.tsx` is the only navigation surface. My Items, Bookings, Collections and Profile are reachable **only** through the avatar dropdown (`frontend/src/components/layout/Header.tsx:161-198`); on mobile the Requests and Share buttons collapse to unlabeled icons and there is no bottom navigation or burger menu. A new user on a phone has no visible path to "my stuff".

**Recommendation:** add a mobile bottom tab bar with the 4–5 core destinations (Browse, Requests, Share/+, Bookings, Profile), keeping the header for search. On desktop, consider surfacing "My Items" as a visible header link. This single change most improves day-to-day usability on phones.

### 2. Booking flow: two competing paths, mismatched granularity, no validation
The rental journey currently offers two disconnected ways to book:

- The **"Rent" button** opens `BookingDialog` immediately, pre-filled with today at the current hour (e.g. "08.07.2026 06:00"), an empty end date, and an editable "Total Price" spinner already showing a value before any period is chosen (`frontend/src/components/items/BookingDialog.tsx:112-145`).
- The **"Select Rental Period" calendar** below supports two-click range selection → "Book Now", opening the same dialog.

Problems observed:
- The week view is a **24×7 hourly grid** even for items priced per day — a wall of ~170 mostly-empty cells; on mobile it has `min-w-[700px]` (`frontend/src/components/items/RentalCalendar.tsx:353`) so only ~2.5 days are visible and the rest needs horizontal scrolling.
- The dialog **submits with no end date and no validation** (`frontend/src/components/items/BookingDialog.tsx:150-157`); "required" asterisks are visual only.
- "Total Price" is editable with a number spinner — it isn't clear this is an *offer*; users will assume it's a computed price.
- After submitting, the user is dropped on the `/bookings` **list**, not the new request's message thread (`frontend/src/components/items/BookingDialog.tsx:166-168`), losing the natural "now talk to the owner" next step.

**Recommendation:** one flow. Calendar granularity should follow `rental_period` (daily → month/day-picker by default, hourly grid only for hourly items). The Rent button should scroll to / open that calendar. The dialog should validate start<end and require an end date (or explicitly support open-end where `rental_open_end`), show a computed price with an "edit your offer" affordance, and success should land in the request thread (`/requests/:id`).

### 3. Privacy: owner email and booker identities exposed
- The item page shows the owner's **email address** to every viewer ("Owner Information — Name / Email"). Combined with federation/public visibility this is a real leak vector.
- Hovering a booked calendar slot reveals **who booked the item and when** (full name) to any logged-in viewer (`frontend/src/components/items/RentalCalendar.tsx:424-433`).

**Recommendation:** replace the email with an in-app "Message owner" CTA (the messaging system already exists); show booked slots simply as "Unavailable" for everyone except the owner.

### 4. My Items on mobile: management actions are unreachable
My Items defaults to a table (`frontend/src/pages/MyItems.tsx:36`) that gets cut off after the Status column on a phone; Price, Created and the **Actions menu (View/Edit/Delete) are off-screen** with no scroll affordance. Practically, users can't edit or delete their listings from a phone without discovering hidden horizontal scroll.

**Recommendation:** default to the existing card view below the `sm` breakpoint (the toggle already exists), or make rows collapse into cards. Same applies to the browse list view (`frontend/src/pages/Index.tsx:349`, `minWidth 720`) and Collections table (`640`).

### 5. Own items on browse look buyable but aren't
The user's own items appear in the browse grid with a **disabled "Buy"/"Rent" button** and no explanation (e.g. the demo user's own armchair). Disabled primary CTAs read as broken.

**Recommendation:** replace with a "Your item — Manage" affordance linking to edit, or a subtle "Yours" badge.

---

## P1 — High-impact UX improvements

### 6. "Requests" vs "Bookings": split mental model, ambiguous direction
Negotiation lives in *Requests*, confirmed rentals in *My Bookings*, and pending items appear in both (plus a "Show pending requests" checkbox on Bookings). Both incoming and outgoing requests are labeled the same way — "Request from demo" is shown *to* demo for their own outgoing request.

**Recommendation:** label direction explicitly ("You requested from Anna" / "Anna wants your bike"), add In/Out filter tabs on Requests, and define the two pages crisply: Requests = inbox/negotiation, Bookings = agreed schedule. Consider renaming Bookings → "My rentals" and linking each booking to its request thread.

### 7. Loading, empty and error states are inconsistent
- The browse **loading state renders in red** — visually identical to the error state right above it (`frontend/src/pages/Index.tsx:259-267`). It reads as a failure on every page load.
- Most pages show bare "Loading..." text (`frontend/src/pages/ItemDetail.tsx:84`, `frontend/src/pages/Bookings.tsx:363`, `frontend/src/pages/Requests.tsx:276`, `frontend/src/App.tsx:52-57`); no skeletons anywhere.
- Browse empty state is a bare `<p>No items found</p>` (`frontend/src/pages/Index.tsx:315-318`) while MyItems/Bookings/Collections have nice icon+CTA empty states — the *most public* page has the worst one.
- "1 items found" grammar.

**Recommendation:** card-shaped skeletons for browse/detail/requests; one shared EmptyState component (icon + message + CTA, e.g. "Clear filters"); reserve red strictly for errors; pluralize counts.

### 8. Browse card density and badge noise
Every card shows an "Available" badge (redundant — nearly everything browsable is available), a raw ISO date (`2026-07-08`), a full-width CTA and a bookmark icon. On mobile the grid is single-column, so **one item fills nearly a whole screen** and 16 items require a very long scroll (the "Wanted (rent)" badge is also nearly invisible on photos).

**Recommendation:** drop the Available badge (show only exceptional states: Reserved/Rented/Sold), use a relative date ("2 d ago") or drop it from cards, and use a 2-column compact grid on mobile. Consider making the type ("For Rent", "Borrow") a colored price-line prefix instead of a photo-overlay badge.

### 9. i18n gaps undermine the German experience
Only EN/DE exist, and German screens still contain hardcoded English: the entire MyItems table header and its delete-confirm dialog (`frontend/src/pages/MyItems.tsx:56-63, 239-245`), CreateItem headings (`frontend/src/pages/CreateItem.tsx:56-64`), all AI-upload progress/toasts (`frontend/src/components/items/ImageUploadStep.tsx`), notification titles (`frontend/src/providers/NotificationProvider.tsx:29-54`), the 404 page, and date formatting via date-fns with English patterns (`frontend/src/pages/Requests.tsx:161`, `frontend/src/pages/Bookings.tsx:163` — English month/day names in a German UI). Currency uses a custom `toFixed(2)` formatter rather than `Intl.NumberFormat` (`frontend/src/lib/currency.ts`), and offers are hardcoded to EUR in places (`frontend/src/pages/Requests.tsx:431`).

**Recommendation:** sweep for hardcoded strings (an ESLint rule for literal JSX text helps), centralize date formatting on the existing `formatDate` util with locale-aware patterns, and switch money display to `Intl.NumberFormat`. Also: the US flag for English is a common papercut — prefer text labels ("EN / DE").

### 10. Keyboard & screen-reader access to core actions
- Clickable rows/cards across browse list, MyItems, Collections, Bookings and Requests are plain `onClick` divs/rows with no `tabIndex`/`role`/key handling — the app is largely mouse/touch-only (`frontend/src/pages/Index.tsx:365`, `frontend/src/pages/MyItems.tsx:253`, `frontend/src/pages/Requests.tsx:218`).
- Calendar day/hour tiles have no `aria-label` (date/state), and booked-slot details are hover-popover-only, unreachable by keyboard or touch (`frontend/src/components/items/RentalCalendar.tsx:392-436`).
- Touch targets: hourly slots are 32 px (`h-8`), carousel dots 8 px; the Requests drawer trigger is an unlabeled icon-button.
- Calendar prev/next aria-labels are hardcoded English.

**Recommendation:** make card/row navigation real links (`<a>`/`Link` wrappers — also enables middle-click/share), label calendar tiles, raise touch targets to ≥40 px, and label icon-only buttons.

### 11. Search & filters are strong but undiscoverable
The faceted search (Type/Category/Collection/Availability/Owner/Price with live counts, URL-persisted) is excellent — but it only appears after clicking into the search field. The browse page itself shows no category entry points, and sort is a small "Date" chip. Facet groups with zero results still render ("Donate/Sell (0)").

**Recommendation:** surface a horizontal category chip row (or type tabs: Borrow · Rent · For sale · Wanted) on the browse page; keep the powerful dropdown for refinement. Hide or de-emphasize zero-count facets. Consider persisting recent searches.

---

## P2 — Medium improvements

### 12. Item detail layout & content hierarchy
The right column stacks badges → title → price → description → owner box → Rent → Add to collection, leaving a large empty area under the (short) image column, then the full-width calendar. "Add to collection" is nearly as prominent as "Rent". The "Used" condition badge is unexplained; "Listed 2 minutes ago" is good.

**Recommendation:** two-column layout where the booking module (calendar + price + CTA) is the sticky right rail (classic marketplace pattern), image gallery left; demote add-to-collection to an icon action; consider showing rental price per period more prominently with a computed example ("3 days ≈ €12").

### 13. Create-item flow: great idea, unclear states
The AI-first flow (photos → AI drafts the listing) is a differentiator, but: buttons are jargon-y ("Continue with AI Processing", "Skip AI, Continue Manually", "Scan Book ISBN" all equally weighted); progress is a fake timer from 65→90% (`frontend/src/components/items/ImageUploadStep.tsx:126-129`); a new item is silently created as **Draft + "donate" + condition "Used"** (`frontend/src/components/items/ImageUploadStep.tsx:83-87`) and the user lands on the edit form with no clear "publish" moment or review-what-AI-wrote step; everything is untranslated.

**Recommendation:** rename actions ("✨ Fill in details for me", "I'll write it myself"), show ISBN scan only for books-like flows or as a secondary link, add an explicit publish step with a status callout on the edit page ("This item is a draft — publish when ready"), and let users review/undo AI-filled fields.

### 14. Login page: unbranded and dead-ended
The login card has no logo/graphic, no language switcher, no "forgot password" or "how do I get an account?" affordance (the "contact your administrator" hint exists in translations but wasn't visible), and generic copy ("Welcome to Bubble").

**Recommendation:** add the logo + a one-line community value proposition ("Borrow and share with your neighbours"), a help/contact link, language toggle, and proper `autocomplete` attributes for password managers.

### 15. Requests detail polish
- Accept/Reject/Counter sit above the message thread; Reject has no confirmation, while Accept warns only on differing offers (`frontend/src/pages/Requests.tsx:531-560`).
- The thread doesn't auto-scroll to the newest message (the auto-scroll effect is commented out, `frontend/src/pages/Requests.tsx:93-97`).
- A React "setState during render" warning fires on this page (observed in console; also indicates a real bug risk).
- Rental period datetimes wrap awkwardly on mobile ("Mon, Jul 13, 2026 06:52" over three lines) — for daily rentals, show dates only.

### 16. Bookings page
Times shown ("18 Jul 26, 06:52 → 21 Jul 26, 06:52") expose the current-hour prefill problem from the booking dialog; for daily rentals show "18–21 Jul" plus duration. The "Show pending requests" checkbox duplicates Requests — link there instead. The page-size select ("Per page: 20") is over-engineering for a community tool — infinite scroll or simple pagination suffices.

### 17. Optimistic updates and mutation feedback
All mutations invalidate-and-refetch with no optimistic state; Accept/Reject/status changes feel slow on a weak connection. Add optimistic transitions (or at least button-level pending states with row-level skeleton) for accept/reject, status dropdowns in MyItems, and sending a message.

### 18. Collections
Solid feature (list/grid, search, "Only mine", item counts). Papercuts: lowercase "items" column header; delete (trash) icon appears without a label next to the chevron; the create modal isn't a drawer on mobile; adding items from a collection page isn't possible (only from item pages).

---

## P3 — Polish & housekeeping

19. **Dark mode:** works well overall (custom warm-brown scale is pleasant). Verify first-paint consistency — a transient state was observed where the first row of cards rendered light-mode styles on a dark page; likely the Tailwind `.dark` class syncing after Mantine (`ColorSchemeSync`). Also verify toasts and the "Welcome back!" notification don't cover the header actions (observed overlapping content on login).
20. **404 page:** unstyled ("Oops! Page not found" + link), untranslated, no header context on some paths. Style it like the empty states and translate.
21. **Console/PII hygiene:** `frontend/src/providers/NotificationProvider.tsx:17` logs full message payloads (chat content) to the console; service worker + barcode logs also ship to production. Remove or gate behind DEBUG.
22. **Dead code:** `frontend/src/App.css` (Vite boilerplate, unused), `frontend/src/components/browse/ConditionFilter.tsx` (superseded by BrowseNav), commented-out auto-scroll effect. Delete.
23. **Design-token consolidation:** two parallel systems — Mantine theme tokens and a Tailwind HSL variable set — are mixed within the same components (`frontend/src/pages/Index.tsx:382`, Requests extensively). Pick Mantine CSS variables as the source of truth and alias Tailwind utilities to them, so future theming (per-community branding?) is one edit.
24. **PWA:** a service worker is registered but there's no manifest/offline UX. Either finish the PWA story (installable, offline browse cache, push notifications — a natural fit for booking requests) or drop the SW to avoid stale-cache surprises. — _Resolved (installable, offline shell + image cache, update prompt); push notifications still open. See `docs/pwa.md`._
25. **Seeding for demos/dev:** this review required writing a custom seed script. A `manage.py seed_demo` command (items with images, users, bookings, collections) would pay for itself in demos, screenshots, e2e and design work.

---

## Suggested roadmap

| Phase | Theme | Contents |
|-------|-------|----------|
| 1 — Quick wins (days) | Trust & clarity | Red loading text → skeleton/neutral (7), hide owner email (3), "Your item" instead of disabled CTA (5), MyItems card-default on mobile (4), pluralization + badge cleanup (8), 404 + login polish (14, 20), console/PII cleanup (21), dead code (22) |
| 2 — Core journeys (1–2 sprints) | Booking + mobile nav | Mobile bottom nav (1), single validated booking flow with period-appropriate calendar (2), success → request thread (2), booked slots anonymized (3), request direction labels + In/Out tabs (6) |
| 3 — Reach & inclusion (1–2 sprints) | i18n + a11y | String sweep + locale dates/currency (9), keyboard-accessible cards/rows/calendar (10), touch targets (10), category chips on browse (11) |
| 4 — Product polish (ongoing) | Delight | Item detail sticky booking rail (12), create-flow publish step + AI review (13), optimistic updates (17), design-token consolidation (23), PWA decision (24) |

**Strengths to preserve:** URL-shareable faceted search with live counts, per-field autosave, the image carousel's accessibility, dark mode's warm palette, CalDAV personal booking calendar, and the AI-assisted listing flow.

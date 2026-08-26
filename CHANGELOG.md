# Changelog

## [0.5.3](https://github.com/sharebubble/bubble/compare/v0.5.2...v0.5.3) (2026-08-26)


### Features

* always show install-app entry on the mobile account hub ([215e5ab](https://github.com/sharebubble/bubble/commit/215e5ab71be580c7f91426678625394b2ac50065))
* **bookings:** replace numbered pagination with scroll-triggered load-more ([26b986d](https://github.com/sharebubble/bubble/commit/26b986d4b57dfd5453b7ca8e8dd3a23c70bbabec))
* **bookings:** show all bookings by default, ordered by last message ([045c0f8](https://github.com/sharebubble/bubble/commit/045c0f8c74173241b3061ba1056daa477d4c91bc))
* **bookings:** show all bookings by default, ordered by last message ([3233bf3](https://github.com/sharebubble/bubble/commit/3233bf395c71bf23cf814cce519fe95ec547f0db))
* **item-bookings:** add per-user booking time stats popup ([1d35630](https://github.com/sharebubble/bubble/commit/1d35630430675546c776a21957345ba36213e31b))
* **item-detail:** color-code bookings by booker, hide owner email, move bookings below calendar ([0f6c11f](https://github.com/sharebubble/bubble/commit/0f6c11f83960d02f54a15ec122fc2024610cc731))
* **item-detail:** color-code bookings by booker, hide owner email, move bookings below calendar ([c9de807](https://github.com/sharebubble/bubble/commit/c9de8073006662f87f411d4aa7c7cc33c817cedc))
* **item-detail:** de-emphasize owner into listed-date line ([5d23fc8](https://github.com/sharebubble/bubble/commit/5d23fc885aa3f752ceedf8e1093ff2935f900c5f))
* **item-detail:** de-emphasize owner, link name to their listings ([fdd8fee](https://github.com/sharebubble/bubble/commit/fdd8feef5c54ba1106f585155e7dc66f7b7b3e0c))
* **mobile-nav:** hide header outside home/browse, defer search focus to second tap ([e46b6ea](https://github.com/sharebubble/bubble/commit/e46b6ea6f51cd6afb09f0fb72afa9e5847789936))
* **mobile-nav:** hide header outside home/browse, defer search focus to second tap ([aeb5f66](https://github.com/sharebubble/bubble/commit/aeb5f665407dff531fac4380dc5060c6e185b4cf))
* noon-to-noon check-in/out for daily rentals with monthly calendar default ([70d26f4](https://github.com/sharebubble/bubble/commit/70d26f4846cd04a943bf4587723b74dfae9ba800))
* prompt mobile users to install Bubble as a PWA on Home ([13ef989](https://github.com/sharebubble/bubble/commit/13ef989d262e70be5dfa6c628c2cee7a0900761b))
* prompt mobile users to install Bubble as a PWA on Home ([b9287cc](https://github.com/sharebubble/bubble/commit/b9287ccb3e83ac82d029884e67b9abf707bb6218))
* **search:** fold accents and tolerate typos ([e2e1c12](https://github.com/sharebubble/bubble/commit/e2e1c1202afcf51f4f705d23c9e8cdba81c29d95))
* **search:** rank title matches above description matches ([0e5b49b](https://github.com/sharebubble/bubble/commit/0e5b49b90b5eb5691503de67655d61b1ffbf9024))
* **search:** rank title matches above description matches ([3077c4f](https://github.com/sharebubble/bubble/commit/3077c4f59b044bcfaa21e314ecb78eaec7a1ee1c))
* **search:** restrict search bar to desktop and mobile home/browse, autofocus on tap ([a35034f](https://github.com/sharebubble/bubble/commit/a35034f5b6f2005ed7e25ee4f15f4051cadc1fec))
* **search:** restrict search bar to desktop and mobile home/browse, autofocus on tap ([ac4ea2d](https://github.com/sharebubble/bubble/commit/ac4ea2d24974f8e4a636d3dc359e7330086fcd01))
* show name and avatar on the account hub, import SSO avatars ([8c03820](https://github.com/sharebubble/bubble/commit/8c0382080684d8274339b926f897d44c0b6cbffe))


### Bug Fixes

* address PWA install banner review feedback ([8beee88](https://github.com/sharebubble/bubble/commit/8beee889ac9a00775fdf40063ada164b86309dd9))
* **bookings:** address review feedback on past-cancel validation ([e9cd46c](https://github.com/sharebubble/bubble/commit/e9cd46c0655e8cd4929c3057444b213f962c93fe))
* **bookings:** stop past confirmed bookings from being cancelled ([5e6aa50](https://github.com/sharebubble/bubble/commit/5e6aa50f6fbd2178ae3fed84b768bf62ddc8775f))
* **bookings:** stop past confirmed bookings from being cancelled ([6c998c5](https://github.com/sharebubble/bubble/commit/6c998c5656b25aba17eadf881400440b66bcbf57))
* **header:** stop top nav from forcing horizontal scroll on narrow screens ([fd0fcda](https://github.com/sharebubble/bubble/commit/fd0fcdac28f8a8bb1c790f58dd3883973bf5b5f5))
* **header:** stop top nav from forcing horizontal scroll on narrow screens ([8b982f8](https://github.com/sharebubble/bubble/commit/8b982f8ed256fce2b5458c2ff7bbb0ad015b5160))
* **header:** use real Mantine buttons for compact header nav ([d1d714e](https://github.com/sharebubble/bubble/commit/d1d714ee04b6461474ebadeae127f01b7d62f0bf))
* **item-detail:** address review — gate owner lookup by auth, fix wording ([353f141](https://github.com/sharebubble/bubble/commit/353f141e83f6af4cf37f5366d7984d289a0e621e))
* keep the mobile Profile tab clickable off the account hub ([cedc783](https://github.com/sharebubble/bubble/commit/cedc783181ee32fe2f623c7a784e3094a4c136a2))
* match desktop profile menu label to the personal settings page ([16f0beb](https://github.com/sharebubble/bubble/commit/16f0beb366af6c65e8ad5b9b9c11676e06d97e3d))
* **notifications:** default Matrix ID to a full [@user](https://github.com/user):hostname ([8533ade](https://github.com/sharebubble/bubble/commit/8533ade1e7acdb46f0e3b2fe8eda23dff83a6e13))
* **notifications:** default Matrix ID to a full [@user](https://github.com/user):hostname ([5a48d7a](https://github.com/sharebubble/bubble/commit/5a48d7a82c286e98acf802924400df8795f85481))
* **notifications:** log Apprise delivery failures at ERROR for Sentry ([1138615](https://github.com/sharebubble/bubble/commit/1138615c0957f2a9943dbd03b0d35619b33f62ac))
* **notifications:** log Apprise delivery failures at ERROR so Sentry captures them ([36061b7](https://github.com/sharebubble/bubble/commit/36061b7f207024c4b531b13d925c7b4e101f0db8))
* **notifications:** prefix RocketChat targets with @ for Apprise DM addressing ([660034a](https://github.com/sharebubble/bubble/commit/660034a2520c3e70c29fa2d98d341bfb981ebd7f))
* **notifications:** stop duplicate Sentry issues for one delivery failure ([7e12c62](https://github.com/sharebubble/bubble/commit/7e12c629508c64e10fe0bf5b927627d164b53027))
* **notifications:** strip whitespace and avoid double @ in Matrix ID default ([9834ed2](https://github.com/sharebubble/bubble/commit/9834ed29b9916f423aabdfc61f750647fec0e074))
* **search:** keep a tie-breaker behind an explicit relevance ordering ([0985a6d](https://github.com/sharebubble/bubble/commit/0985a6d811d182c0879cd52186075db28f11971d))
* **search:** preserve hash when clearing one-shot focus-search state ([e936c8f](https://github.com/sharebubble/bubble/commit/e936c8f3cb10311732f2ac79f6123916860e7c4a))

## [0.5.2](https://github.com/sharebubble/bubble/compare/v0.1.2...v0.5.2) (2026-08-18)


### Miscellaneous Chores

* align application and Helm chart versions at 0.5.2

## [0.1.2](https://github.com/sharebubble/bubble/compare/v0.1.1...v0.1.2) (2026-07-07)


### Features

* **bookings:** redesign /bookings as a calendar-style agenda ([7ea3e48](https://github.com/sharebubble/bubble/commit/7ea3e48b2cf29b07ca97f868a56b68bfb2303ce3))
* **bookings:** redesign /bookings as a calendar-style agenda ([73545e2](https://github.com/sharebubble/bubble/commit/73545e2e3ddc2d90e6af9386311b93c7876d2c24))
* **caldav:** add CalDAV and iCalendar calendar sharing for bookings ([4bcb09d](https://github.com/sharebubble/bubble/commit/4bcb09da9c87b7033e177c59b3b0b5dcc78618c7))
* **caldav:** add calendar feeds and CalDAV for bookable items ([0a7df17](https://github.com/sharebubble/bubble/commit/0a7df172e1f7ca82128a4eaae3bb395cae5ac470))
* **caldav:** expose read-only subscribe link to all viewers; cap my-items description ([b8ac9fa](https://github.com/sharebubble/bubble/commit/b8ac9fa1435ab53fc1732c9e2644e187218ac0b6))
* **caldav:** name calendars after the item/collection and show booker per event ([d4a1c4b](https://github.com/sharebubble/bubble/commit/d4a1c4b7e2991bb1c980233a842c8842b81bfd75))
* **calendar:** add hover-based range preview to rental calendar ([af23d43](https://github.com/sharebubble/bubble/commit/af23d43cd92cff169987e4525063802bdd65fda0))
* **collections:** add editable slug for collections ([273d228](https://github.com/sharebubble/bubble/commit/273d22884af02f6d5e2ca7dce0a79ff98661eb8d))
* **collections:** add editable slug for collections ([29e7db3](https://github.com/sharebubble/bubble/commit/29e7db3f6681a8d0efcbe58b9d0dbf9097915c31))
* **frontend:** add faceted search popup to the header search bar ([2584342](https://github.com/sharebubble/bubble/commit/2584342541ca4bf403a122f987f1e16d768271b0))
* **frontend:** add Mantine color mapping for item status badges ([e9bc754](https://github.com/sharebubble/bubble/commit/e9bc754913dd0e4dc6bd0bf1818bbface082063c))
* **frontend:** add Mantine dates, modals, form and carousel packages ([7f43e6e](https://github.com/sharebubble/bubble/commit/7f43e6e4c894ac6fb05d2403797d0ead519679c9))
* **frontend:** reorder search facets and cross-filter the popup ([d67a04c](https://github.com/sharebubble/bubble/commit/d67a04c3cbde3af4000554bbe8d637e16f068cff))
* **frontend:** show all items by default and add price filters ([ff23644](https://github.com/sharebubble/bubble/commit/ff23644c791c5e68242273439e23ed61332913d5))
* **frontend:** show all items by default and add price filters ([0b5fea9](https://github.com/sharebubble/bubble/commit/0b5fea935a4b39116f26fd7a29770fc2a6565b97))
* **frontend:** use warm-brown dark mode palette ([d7511ae](https://github.com/sharebubble/bubble/commit/d7511aef6a596eecdf382d8a66cfb34343209a5f))
* **item-detail:** close the image viewer when clicking the image ([a92f095](https://github.com/sharebubble/bubble/commit/a92f09597681733bcac6309c53d3f59be00c229c))
* **items:** add cross-filtered type facet with counts ([29378b4](https://github.com/sharebubble/bubble/commit/29378b474642039f4b72ea8794ba9eda3d274384))
* **items:** add generic Location model for item placement ([000b69d](https://github.com/sharebubble/bubble/commit/000b69d3d95e0f251999ccb65f424fa31b6062c2))
* **items:** add Location model for item placements (shelves, shared areas) ([4d9cc60](https://github.com/sharebubble/bubble/commit/4d9cc60e81664b97c94e97c320e0f1a61d846ab6))
* **items:** add owner/category search facets and collection filter ([99c2e09](https://github.com/sharebubble/bubble/commit/99c2e09c33442699d35bc51dbc4558f93e473711))
* **items:** cross-filter search facets in a single endpoint ([7deefdc](https://github.com/sharebubble/bubble/commit/7deefdcfc09895f69d1649c6989bb93d6ca30569))
* **items:** show current location on the item detail screen ([235b9ed](https://github.com/sharebubble/bubble/commit/235b9edd07c52f21bf8196f81fc741c88a74f83d))
* **notifications:** add Matrix as a notification channel ([c99ab15](https://github.com/sharebubble/bubble/commit/c99ab155f22c000601d0ba06cb9a3734ecf83633))
* **notifications:** unified Apprise notifications with per-channel preferences ([ae3031c](https://github.com/sharebubble/bubble/commit/ae3031cc70f4651bf3d79cf16669cd1b3ec8ba1e))
* **notifications:** unified Apprise notifications with per-channel preferences ([38f7b52](https://github.com/sharebubble/bubble/commit/38f7b5291f994fe6085e022dcacff960ccb7b09a))
* rename helm charts, remove static pvc ([030d05c](https://github.com/sharebubble/bubble/commit/030d05c6c610a5abb5d5ad94d017cc3f941c40b7))
* **search:** faceted header search bar with owner, collection, category and availability filters ([743fcd4](https://github.com/sharebubble/bubble/commit/743fcd47ecbcb76cd823ba574c74ef415d9db92f))


### Bug Fixes

* add horizontal scroll container to list view tables ([4e47a20](https://github.com/sharebubble/bubble/commit/4e47a2022e2a6537bf8cea0bb48bbb449bab1cfc))
* add missing migration ([cbf2742](https://github.com/sharebubble/bubble/commit/cbf27425532f7e7c0fd48c0dcf710a1484dcdbca))
* **bookings:** address Copilot review feedback ([6c85add](https://github.com/sharebubble/bubble/commit/6c85addd597154a49eb103d2d300eb1611826eff))
* **caldav:** address review feedback on CalDAV booking + subscribe UI ([0a7d0a4](https://github.com/sharebubble/bubble/commit/0a7d0a495c0f8c873539a8db005c3aed4af1065b))
* **caldav:** pass choices enum directly to satisfy django-upgrade ([432f682](https://github.com/sharebubble/bubble/commit/432f682cfaaeed7fc01a857339f7419fe53efbcf))
* **calendar:** use color-scheme-aware backgrounds for selection panels ([954c88d](https://github.com/sharebubble/bubble/commit/954c88db0abc1ad2fc23b03681906eb5abc1f4e0))
* **collections:** address review feedback on slug ([5b2b630](https://github.com/sharebubble/bubble/commit/5b2b630a7d846645029ff91116690376799d5403))
* **deps:** patch dependabot-flagged vulnerabilities ([2039818](https://github.com/sharebubble/bubble/commit/203981854c9f0ac5e7b1c89ea7070d81c2228560))
* **deps:** patch Dependabot-flagged vulnerabilities ([e743834](https://github.com/sharebubble/bubble/commit/e743834e673a68e1f3dde33d7fc51d3b62960f8f))
* **deps:** resolve cryptography/fido2 conflict and sync uv.lock ([fc29257](https://github.com/sharebubble/bubble/commit/fc29257ee0280e917bcf3986577455ca4a10e5b7))
* filter CancelledError from Sentry (client disconnects) ([ce7d3a6](https://github.com/sharebubble/bubble/commit/ce7d3a61ec1bc73835e4574a67ceccec3b1208fd))
* **frontend:** address Copilot review feedback ([9328162](https://github.com/sharebubble/bubble/commit/9328162203eba0d9f09b03bade1fa6eaf940e4e5))
* **frontend:** address search-bar review feedback ([391d495](https://github.com/sharebubble/bubble/commit/391d4956870f1167fae357f8ccd7a8098b6e6e53))
* **frontend:** make Add to collection popover open on click ([9598112](https://github.com/sharebubble/bubble/commit/959811292d3195418684940687d502017e8dcc46))
* **frontend:** proxy /caldav/ to the backend in dev and prod ([3b01c65](https://github.com/sharebubble/bubble/commit/3b01c65f2dab0eab9441bb04223afb87ee4b0bc7))
* **frontend:** resolve dependabot npm group update issues ([1b40b0f](https://github.com/sharebubble/bubble/commit/1b40b0fb7aa71b7044e5b147b8d97e8dcd996286))
* **frontend:** use replace for incremental price filter updates ([6ccc4bf](https://github.com/sharebubble/bubble/commit/6ccc4bf833ca11f0efa39817bd0954b1a86a99c5))
* header width corrected ([78ad169](https://github.com/sharebubble/bubble/commit/78ad169e481d9c9eb81014efdb2113a5bfdc3832))
* icon sizes ([d7bdd26](https://github.com/sharebubble/bubble/commit/d7bdd2697574bd4d992576789c3c5a25caaf4bcf))
* improve filter popup ([45af635](https://github.com/sharebubble/bubble/commit/45af635eab808c518f083853cf312db6bb0b257b))
* **item-detail:** distinguish image drag from click in the viewer ([09f3ed6](https://github.com/sharebubble/bubble/commit/09f3ed6a524de5d63aa46f38c58e99c133b3100f))
* **item-detail:** prevent gallery from stretching below the image ([b7ccfbe](https://github.com/sharebubble/bubble/commit/b7ccfbe2004cfc10628f6c330ce092db6033262f))
* **item-detail:** remove light placeholder strip and harden gallery controls ([bd43089](https://github.com/sharebubble/bubble/commit/bd430899f0e54ca2d668d1d34a29914ba6bac072))
* **item-detail:** use native buttons for carousel navigation controls ([4ea65c1](https://github.com/sharebubble/bubble/commit/4ea65c1fca47ef35b689f1303acc3a75ff9eb230))
* **items:** address review feedback on locations endpoint ([fc0aac7](https://github.com/sharebubble/bubble/commit/fc0aac73947f05201747f244455199ce2c6e3977))
* make "free only" filter match null/zero-price items ([bbe2032](https://github.com/sharebubble/bubble/commit/bbe2032ff98e10d11d9f3c2bc31d1a010ea7c4b0))
* **notifications:** address Copilot review feedback ([669ecde](https://github.com/sharebubble/bubble/commit/669ecde55f730ae4e0d45f5638b1678f1a247fed))
* **notifications:** address review feedback and linter ([d1e0485](https://github.com/sharebubble/bubble/commit/d1e0485d80e117b2358073a62368967f15741392))
* period selection other than hourly didnt work ([0c0b624](https://github.com/sharebubble/bubble/commit/0c0b624bc6ca9f7dd83bde239012894f9239b128))
* restore vertical scrolling on table list views for small screens ([798af89](https://github.com/sharebubble/bubble/commit/798af8987bf1da20680f11edd4fee9bf6211fefd))
* **search:** keep filters close button always visible ([97c0098](https://github.com/sharebubble/bubble/commit/97c00980d7c748dad7b24abb9fdf43c3d347ee7a))
* skill formatting ([e71cdd5](https://github.com/sharebubble/bubble/commit/e71cdd583a8ef869de5cb78d7c6753aa61ccfd51))
* sorting ([5d42bd6](https://github.com/sharebubble/bubble/commit/5d42bd6e648193b13cd3a5fbe109cd1528272bd5))
* suppress WebSocket ConnectionClosedError in Sentry and handle gracefully ([c7e4234](https://github.com/sharebubble/bubble/commit/c7e4234f70e730b775df9bedeb3dafa1ff4aa866))


### Performance Improvements

* add database indexes for slow queries ([425c8f5](https://github.com/sharebubble/bubble/commit/425c8f5af1f9ff2195ee5c90e10142875f77f5dd))
* **frontend:** drop search scale transition in logged-in header too ([84bddaf](https://github.com/sharebubble/bubble/commit/84bddafc81ef688df5dacbfd06fc7a1c7e4e8932))
* **frontend:** optimize rendering for mobile and low-power devices ([dc4cd22](https://github.com/sharebubble/bubble/commit/dc4cd222447df6cf82c5ed6686b1e16252475999))
* **item-detail:** serve 1200px preview in the fullscreen image viewer ([e69c439](https://github.com/sharebubble/bubble/commit/e69c4399a6c179590d5e0072bd36767b8607a69a))
* **item-detail:** serve 1200px preview in the fullscreen image viewer ([e093aff](https://github.com/sharebubble/bubble/commit/e093aff6919e0cd92effd592e633246b8ab1578e))
* **items:** consolidate facet counts and index (status, created_at) ([c2cad63](https://github.com/sharebubble/bubble/commit/c2cad63eecc10a79f0f9ead3d5ac911b55c714c6))
* **items:** eliminate N+1 queries in item list endpoints ([5183ce6](https://github.com/sharebubble/bubble/commit/5183ce6813aae3c3113d0df0214a1c978fbf03a6))
* **items:** serve lighter scaled-down preview images on item detail ([0561f92](https://github.com/sharebubble/bubble/commit/0561f92023775439b2b5e2d572aa4907523af705))
* **items:** serve lighter scaled-down preview images on item detail ([94b2120](https://github.com/sharebubble/bubble/commit/94b2120d29fc13f248040b785bf78212d9d9fdd7))
* **items:** speed up item loading — fix N+1s, consolidate facet counts, add index ([3f0dd1e](https://github.com/sharebubble/bubble/commit/3f0dd1e62f01c7bec497138aecc958493eaabb84))
* optimize frontend rendering for mobile devices ([806e0e4](https://github.com/sharebubble/bubble/commit/806e0e4cfc5b9c19159c4c2853f1da516e4220de))

## [0.1.1](https://github.com/sharebubble/bubble/compare/v0.1.0...v0.1.1) (2026-06-02)


### Features

* add federation ([e52599d](https://github.com/sharebubble/bubble/commit/e52599d3a55f366ebca5e5972ac4663596cb34d0))
* Add federation ([12056af](https://github.com/sharebubble/bubble/commit/12056af63bffa1a44145362e6e9b60774f0ed897))


### Bug Fixes

* copilot suggestion for image mode ([2a8f46c](https://github.com/sharebubble/bubble/commit/2a8f46c1ebbfe90a7bb5aab110bde0ad08912160))
* image rotation ([4d2619a](https://github.com/sharebubble/bubble/commit/4d2619a05c47c1b27492e87941d2b828c11b2882))
* localize rotate button aria-labels using t() in ImageManager ([e2cbb7a](https://github.com/sharebubble/bubble/commit/e2cbb7a948853253affac45a6b13d7268ab0a357))
* rotate based on exif info ([413747e](https://github.com/sharebubble/bubble/commit/413747e1801d5e71fa7b08f537c01f551667f7e1))

<div align="center">
  <h1>MListCo Vehicle Filter</h1>
  <p><strong>A fast, browser-native filtering layer for MListCo vehicle inventory.</strong></p>
  <p>
    <img alt="Version 1.5.1" src="https://img.shields.io/badge/version-1.5.1-f5a623?style=flat-square">
    <img alt="JavaScript ES2020" src="https://img.shields.io/badge/JavaScript-ES2020-f7df1e?style=flat-square&logo=javascript&logoColor=000000">
    <img alt="Tampermonkey userscript" src="https://img.shields.io/badge/runtime-Tampermonkey-171717?style=flat-square&logo=tampermonkey&logoColor=ffffff">
    <img alt="41 passing tests" src="https://img.shields.io/badge/tests-41%20passing-2ea44f?style=flat-square">
  </p>
  <p>
    <a href="https://raw.githubusercontent.com/FurkanSource/mlistco-filter/main/mlistco-filter.user.js"><strong>Install userscript</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="#features">Features</a>
    &nbsp;&middot;&nbsp;
    <a href="#how-mileage-filtering-works">How it works</a>
    &nbsp;&middot;&nbsp;
    <a href="#development">Development</a>
  </p>
</div>

![MListCo Vehicle Filter running on MListCo inventory](docs/assets/mlistco-filter-preview.jpg)

<p align="center"><sub>Version 1.5.1 running on live MListCo vehicle inventory. P.S filter not applied in image</sub></p>

## Overview

MListCo Vehicle Filter is a Tampermonkey userscript that adds precise client-side filtering to
MListCo listings. It combines make/model search with year, price, mileage, and sold-status
controls while preserving the browsing state when a listing is opened.

The project is written as modular JavaScript and compiled into one self-contained userscript for
installation. It has no backend, API keys, external database, or telemetry.

| Runtime | Source | Build | Verification | Permission model |
| --- | --- | --- | --- | --- |
| Tampermonkey | JavaScript ES modules | esbuild | Node test runner + JSDOM | `@grant none` |

## Features

| Capability | Behavior |
| --- | --- |
| Make and model search | Matches every search term, so `m3 xdrive` narrows results precisely. |
| Range filters | Filters by minimum and maximum year, price, and mileage. |
| Sold-listing control | Hides sold vehicles with one checkbox. |
| Accurate mileage mapping | Associates response data with the correct card using stable listing identity, never response order. |
| Inventory loading | Loads toward a requested count from 1-9999; a blank target defaults to 200. |
| Navigation continuity | Restores native filters, custom filters, loaded-card count, and scroll position after viewing a listing. |
| Dynamic-page support | Reapplies active filters when Bubble adds cards or finishes lazy-loading listing identity data. |
| Honest unknown handling | Excludes unknown or ambiguous mileage while a mileage filter is active and reports it in the status. |

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in a Chromium-based browser.
2. Open the [raw userscript](https://raw.githubusercontent.com/FurkanSource/mlistco-filter/main/mlistco-filter.user.js).
3. Approve the Tampermonkey installation prompt.
4. Visit `https://mlistco.com/listings` and use the filter panel in the upper-right corner.

To update a manual installation, reopen the raw userscript link and approve the newer version.

The installable file is [`mlistco-filter.user.js`](./mlistco-filter.user.js). Do not install files
from `src/` directly; they are the modular development source.

## Usage

1. Enter a make, model, or multiple search terms.
2. Add any year, price, or mileage bounds you need.
3. Optionally enable **Hide sold listings**.
4. Select **Apply**.
5. To search more inventory, enter a target beside **Load cars** and select **Load inventory**.

**Reset** clears the custom filters and makes all currently loaded listing cards visible again.

## How mileage filtering works

Mileage is present in MListCo's existing Bubble listing response even though it is not always
rendered on the listing card. The userscript captures that response locally and builds a
versioned mileage registry without opening every vehicle detail page.

```mermaid
flowchart LR
  A[MListCo listing response] --> B[Fetch and XHR interceptor]
  B --> C[Versioned mileage registry]
  D[Rendered listing cards] --> E[Card parser]
  C --> F[Identity matcher]
  E --> F
  F --> G[Filter controller]
  G --> H[Card visibility and status]
```

Matching follows a conservative identity hierarchy:

1. Stable Bubble image asset identifier shared by the response and rendered card.
2. Listing slug when one is present in the card markup.
3. A unique normalized combination of title, price, and seller location.

The registry deliberately does not match by array position or by price/year alone. If a match is
missing or ambiguous, the script leaves the mileage unknown instead of assigning another car's
value. Cached records expire after seven days, and timestamped cross-tab updates cannot replace
newer data with stale mileage.

## Architecture

```text
src/
  core/          Shared browser, timing, and normalization utilities
  filters/       Filter state and native MListCo filter restoration
  listings/      Card parsing, filtering, DOM watching, and inventory loading
  mileage/       Response interception, identity matching, and cache management
  navigation/    New-tab handoff, history hooks, and scroll restoration
  ui/            Panel markup, styling, behavior, and status rendering
scripts/         Deterministic userscript build and verification
test/            Unit and browser-DOM integration tests
docs/assets/     README media
```

`src/main.js` composes the modules. esbuild then embeds the JavaScript, HTML, and CSS into the
classic single-file format required by Tampermonkey.

## Development

### Requirements

- Node.js 18 or newer
- npm

### Set up the project

```powershell
git clone https://github.com/FurkanSource/mlistco-filter.git
cd mlistco-filter
npm ci
```

### Build and verify

```powershell
npm run build
npm run check
```

`npm run build` regenerates `mlistco-filter.user.js`. `npm run check` verifies that the committed
bundle is a deterministic build, validates its metadata and classic-JavaScript syntax, and runs
the complete test suite.

## Test coverage

The current release passes **41 automated tests** covering:

- price, mileage, year, query, and sold-status parsing;
- realistic Bubble response ingestion and image-asset identity matching;
- ambiguous, reversed-order, load-more, lazy-image, and stale-cache cases;
- active-filter reapplication after dynamically inserted cards;
- navigation state, new-tab handoff, and scroll restoration;
- startup when browser storage is unavailable; and
- the final generated userscript operating inside a browser DOM.

## Privacy and scope

- All processing happens in the browser.
- The script does not contain API keys or send telemetry.
- Filter state and the mileage cache remain in browser storage.
- Mileage comes from responses the MListCo page already requests.
- The userscript runs only on `mlistco.com` and its subdomains.

## Known constraints

- Filtering applies to listings currently loaded in the page; use **Load inventory** to expand the set.
- An active mileage range excludes cards whose mileage cannot be matched safely.
- Changes to MListCo's DOM or response schema may require selector or field updates.

## Contributing

[Bug reports](https://github.com/FurkanSource/mlistco-filter/issues) and focused pull requests are
welcome. Run `npm run check` before submitting a change and include regression coverage for
behavior changes.

---

This is an independent project and is not affiliated with or endorsed by MListCo.

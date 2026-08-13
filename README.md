# MListCo Vehicle Filter

A Tampermonkey userscript that adds make/model search, year, price, mileage, and sold-status filtering to MListCo vehicle listings. It also restores listing position and filters after opening a vehicle, maps mileage from MListCo's existing listing response without opening detail pages, and can optionally load inventory to a custom target count.

## Install

Install [mlistco-filter.user.js](./mlistco-filter.user.js) in Tampermonkey. The generated file contains the userscript metadata, JavaScript, HTML, and CSS required at runtime.

## Project structure

```text
src/
  core/          Shared browser and timing utilities
  filters/       Filter state and native MListCo filter restoration
  listings/      Card parsing, filtering, and inventory loading
  mileage/       Network response interception and mileage registry
  navigation/    New-tab continuity, history hooks, and scroll restoration
  ui/            Panel behavior, HTML, CSS, and status rendering
scripts/         Reproducible build and bundle verification
test/            Unit and browser-DOM integration tests
```

The source is modular for development. `npm run build` bundles it into the single classic userscript Tampermonkey requires.

Mileage records are associated with cards by stable listing identity. The primary key is the
Bubble image asset ID shared by the listing response and rendered card; a unique normalized
title, price, and seller location is used only as a fallback. Unknown or ambiguous records are
excluded while a mileage limit is active and reported in the filter status.

## Development

```powershell
npm install
npm run build
npm run check
```

Run `npm run build` after changing anything in `src/`. `npm run check` then verifies the
installable userscript without rewriting it and runs the complete test suite. Verification confirms that the output:

- starts with the required Tampermonkey metadata;
- contains embedded HTML and CSS;
- contains no unresolved module syntax;
- parses as classic JavaScript; and
- exactly matches a clean rebuild.

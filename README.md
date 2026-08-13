# MListCo Vehicle Filter

A Tampermonkey userscript that adds make/model search, year, price, mileage, and sold-status filtering to MListCo vehicle listings. It also restores listing position and filters after opening a vehicle, captures mileage from page data, and can load additional inventory before filtering.

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

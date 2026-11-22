# Coin logos — provenance and licence

These files are **vendored**, not fetched at runtime. The widget's security
promise is that the only outbound connection is the Binance Futures price feed;
downloading a logo from a CDN would break that promise for a decoration, so the
logos ship with the app and are loaded from disk like any other asset.

Nothing here is fetched while the widget runs.

## Sources

| Source | Licence | Files | Format |
|---|---|---|---|
| [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) | CC0-1.0 (public domain) | 43 | SVG |
| [CoinCap](https://coincap.io) asset icons | Free to use, provided as-is | 34 | PNG |

CC0 imposes no attribution requirement; the credit is here because it is the
honest thing to do, and because the next person to add a coin needs to know
where the existing ones came from.

## Adding a coin

1. Drop the file in this directory, named `<ticker>.svg` or `<ticker>.png`
   (lowercase, e.g. `ldo.png`).
2. Add the ticker to `COIN_ICON` in `src/coin-icon.js`.
3. Add a brand colour to `BRAND` in the same file — the allocation bar and the
   ticker text use it, and a coin with a logo but no colour would render its
   bar in a hash colour.
4. Run `npm test`. `test/coin-icon.test.js` walks `COIN_ICON` and fails if a
   listed file is missing or empty, so a typo cannot ship as a broken image.

A coin with no file here is not a problem: `badgeFor()` falls back to a drawn
badge — a rounded square in the coin's brand colour with its ticker inside.
That is what every version before this one drew, and it identifies the coin at
a glance.

## Why some coins are PNG

The spothq set predates most of the 2023-2025 listings, so coins like LDO,
NEAR, SUI, TIA, ONDO and ENA are not in it. CoinCap covers them. Mixing the two
formats is fine: `.coin-img` uses `object-fit: contain`, so a PNG with a little
transparent margin renders at the same visual size as an SVG that fills its box.

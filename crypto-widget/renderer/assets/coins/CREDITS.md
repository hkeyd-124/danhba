# Coin logo credits

Every coin logo the widget can draw, where it came from, and under what licence.
Nothing here is fetched at runtime — see "How they ship" below.

## Where they come from

| Source | Licence | Coins | Format as vendored |
|---|---|---|---|
| [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) | CC0-1.0 (public domain dedication) | 43 | **SVG** (vector) |
| [cryptologos.cc](https://cryptologos.cc) | Free for use in applications | 23 | **SVG** (vector) |
| [coincap.io](https://coincap.io) asset icons | Public asset set published by CoinCap | 11 | PNG, 64×64 |

Both sets permit redistribution. CC0 imposes no conditions at all; CoinCap's
icon set is published for use by third-party applications, and cryptologos.cc
offers its logos free for use in applications.

**Total: 77 coins.** A coin with no entry here keeps the drawn badge (a rounded
square in the coin's brand colour with its ticker inside), which is what every
version before this one drew.

### The 43 from spothq

`AAVE ADA ALGO ATOM AVAX BCH BNB BTC CHZ COMP CRV DASH DOGE DOT ENJ EOS ETC ETH
FIL GRT ICP KSM LINK LTC MANA MATIC MKR NEO ONE QTUM SAND SNX SOL STX THETA TRX
UNI VET XLM XMR XRP ZEC ZIL`

### The 23 from cryptologos.cc

`APT ARB AXS DYDX EIGEN ENA FLOW GALA HBAR IMX INJ LDO NEAR ONDO OP PYTH RUNE
SHIB SUI TAO TIA TON WIF`

### The 11 from CoinCap

`BERA FET HYPE JUP PENGU POL RENDER RNDR SEI VIRTUAL WLD`

## How they ship

The logos are **not** stored as files here. They live in `src/coin-data.js` as
base64 data URIs, and that module is what `src/coin-icon.js` reads.

Two reasons, both structural:

1. **The renderer is sandboxed.** It has no `require`, no `fs`, and cannot read
   the disk, so the image bytes have to travel with the state the main process
   pushes. A file path would be unusable there.
2. **The CSP forbids everything else.** The page allows `img-src 'self' data:`
   and nothing more, so a data URI is the only kind of image the widget can
   paint — and it can never point off the machine.

Nothing is downloaded while the widget runs. The only outbound connection the
app ever makes is the Binance Futures price feed.

## Why SVG for one set and 64×64 PNG for the other

**This is a correction.** Earlier versions vendored all 77 logos as 20×20 PNG,
and the reasoning written here at the time was that a small raster is "already
more resolution than any of them will ever use". That was wrong, and it is what
made the icons look blurry:

- `.coin` is drawn at **22px** in the panel. A 20×20 source is therefore
  **upscaled** by the browser — the one thing a raster must never be asked to
  do. On a HiDPI screen it is worse still: 22 CSS px is 44 device px at 2×.
- The taskbar strip draws at 11px, where 20×20 happens to be enough. The panel
  is what exposed it.

So the set was rebuilt:

- **66 coins are now SVG** (43 from spothq, 23 from cryptologos.cc). Vector, so
  they are sharp at any size and any device-pixel ratio, and they cost *less*
  than the PNGs they replaced.
- **11 coins stay PNG at 64×64** — the largest CoinCap publishes. These are the
  coins no source publishes as SVG. 64×64 is ~3× the drawn size, which leaves
  headroom for HiDPI.

Both sets draw a circular disc, so the two formats mix without looking ragged.

`test/coin-icon.test.js` now enforces this: it fails if any raster logo is
smaller than the size it is drawn at, and if any vector logo lacks a `viewBox`
(an SVG without one does not scale, and is as soft as a small raster).

## Regenerating

`src/coin-data.js` is generated. Do not edit it by hand.

```bash
node build/make-coin-data.js <svg-dir> <png-dir>
```

The script minifies each SVG (whitespace and comments only — the `viewBox` is
left alone, since rewriting it would crop the logo), asserts every PNG is at
least 64×64, and writes the module with a header recording the counts.

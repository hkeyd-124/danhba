# Coin logo credits

Every coin logo the widget can draw, where it came from, and under what licence.
Nothing here is fetched at runtime — see "How they ship" below.

## Where they come from

| Source | Licence | Coins | Format as vendored |
|---|---|---|---|
| [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) | CC0-1.0 (public domain dedication) | 43 | PNG, 24×24 |
| [coincap.io](https://coincap.io) asset icons | Public asset set published by CoinCap | 34 | PNG, 24×24 |

Both sets permit redistribution. CC0 imposes no conditions at all; CoinCap's
icon set is published for use by third-party applications.

**Total: 77 coins.** A coin with no entry here keeps the drawn badge (a rounded
square in the coin's brand colour with its ticker inside), which is what every
version before this one drew.

### The 43 from spothq

`AAVE ADA ALGO ATOM AVAX BCH BNB BTC CHZ COMP CRV DASH DOGE DOT ENJ EOS ETC ETH
FIL GRT ICP KSM LINK LTC MANA MATIC MKR NEO ONE QTUM SAND SNX SOL STX THETA TRX
UNI VET XLM XMR XRP ZEC ZIL`

### The 34 from CoinCap

`APT ARB AXS BERA DYDX EIGEN ENA FET FLOW GALA HBAR HYPE IMX INJ JUP LDO NEAR
ONDO OP PENGU POL PYTH RENDER RNDR RUNE SEI SHIB SUI TAO TIA TON VIRTUAL WIF
WLD`

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

## Why 24×24 PNG and not the original SVG

The icons are drawn at 11px in the taskbar strip and 18px in the panel, so a
24×24 raster is already more resolution than any of them will ever use, and it
is a fraction of the size: the same 77 logos as SVG were 70KB of base64, as
PNG they are 32KB. At these display sizes the two are indistinguishable, and
the smaller module keeps the renderer's state payload lean.

The SVGs were rasterised once, offline, when `coin-data.js` was generated. They
are not rasterised at runtime.

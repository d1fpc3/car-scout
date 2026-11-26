# car-scout

Watches Craigslist cars around Baltimore, values every listing against comparable
listings, and pushes the underpriced private-seller ones to your phone.

## How it decides a car is a deal

1. **Comps.** Once a day it pulls every car listing within `compsRadius` miles (about 10k cars).
   Every 15 minutes it adds the newest ones. Listings stay in the pool for 30 days.
2. **Value.** For each make + model with 12+ comps it fits
   `log(price) = a + b·age + c·miles` and drops outliers (typos, $1 placeholders, salvage).
3. **Screen.** A private-seller car within `radius` miles, posted in the last 72 h, priced
   2k+ under the cautious value (fit minus half a standard deviation) and at 40–80% of value.
4. **Confirm.** It opens the listing: clean title only, real odometer, and nothing like
   salvage / needs transmission / not running / $500 down / escrow in the text.
   Softer words (as-is, check engine, rust) ride along in the alert.
5. **Alert.** Push via ntfy with the photo; tap opens the listing, **All deals** opens the
   board. Re-alerts only on a $400+ price drop.

## Run it

```
node scout.mjs --dry     # print deals, no alerts
node scout.mjs           # needs NTFY_TOPIC (or DISCORD_WEBHOOK)
node scout.mjs --full    # force the full comps refresh
npm test
```

## Settings you'd change

All in `config.json`. Edit it on GitHub and commit; the next run (within 15 min) uses it.

| Setting | Now | What it does |
|---|---|---|
| `postal` | `21201` | Zip code the search is centered on. |
| `radius` | `75` | How far (miles) you'd drive to buy. |
| `buy.minPrice`, `buy.maxPrice` | `1500`, `15000` | Asking-price range you care about. |
| `buy.minProfit` | `2000` | How far under value the asking price has to be before you hear about it. |
| `flipCost` | `1000` | What a flip costs you (tax, tags, inspection, cleanup). Taken off the profit shown in alerts and on the board; doesn't change which cars qualify. |

Leave the rest alone unless something looks off.

## Deals board

Every run also publishes a page with every current deal, best profit first: photo, miles,
asking, value, profit, distance and how long it's been listed.
**https://d1fpc3.github.io/car-scout/**

The page is public-hosted but **encrypted**. It holds only AES-GCM ciphertext, which the
browser opens with the `BOARD_PASSPHRASE` secret. You type it once per device (the browser
keeps a derived key, not the passphrase). The **All deals** button on each alert carries the
passphrase in the link's `#k=` fragment, so from the phone it opens straight in. That makes
the ntfy topic name the real secret, so keep it private. To lock out every device, change the passphrase.

One-time setup: Settings → Pages → Source: **GitHub Actions**, then add the
`BOARD_PASSPHRASE` repo secret (a long random string). Without the secret, the board is skipped.

## Phone

Install **ntfy** (iOS / Android), tap **+**, subscribe to the topic in the `NTFY_TOPIC`
repo secret (also in the local `.env`, which is not committed).

## Where it runs

GitHub Actions, every 15 minutes (`.github/workflows/scout.yml`). State lives in the
Actions cache, not in the repo, and CI logs print counts only.

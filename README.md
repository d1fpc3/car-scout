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
5. **Alert.** Push via ntfy with the photo; tap opens the listing. Re-alerts only on a
   $400+ price drop.

## Run it

```
node scout.mjs --dry     # print deals, no alerts
node scout.mjs           # needs NTFY_TOPIC (or DISCORD_WEBHOOK)
node scout.mjs --full    # force the full comps refresh
npm test
```

Knobs are in `config.json` (zip, radius, price range, minimum profit).

## Phone

Install **ntfy** (iOS / Android), tap **+**, subscribe to the topic in the `NTFY_TOPIC`
repo secret (also in the local `.env`, which is not committed).

## Where it runs

GitHub Actions, every 15 minutes (`.github/workflows/scout.yml`). State lives in the
Actions cache, not in the repo, and CI logs print counts only.

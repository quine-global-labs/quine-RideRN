# Pricing model

RideRN prices rides with a basic model inspired by what's publicly known about Uber and Lyft. Their actual models are proprietary machine-learning systems; this is a transparent approximation to build on, not a copy. The code is `server/pricing.mts`; the dispatch server applies it (`server/dispatch.mts`).

## What's publicly known

- **Base formula.** A base fare, plus a per-minute rate times estimated time, plus a per-mile rate times estimated distance, plus a booking fee, with a minimum fare. Rates differ by city and ride type. ([Ridester](https://www.ridester.com/uber-rates-cost/), [RideGuru](https://ride.guru/lounge/p/uber-pricing-how-does-it-work))
- **Surge / Prime Time.** A multiplier on that base when demand outstrips drivers. Lyft applies Prime Time as a percentage of the subtotal ([TaxiFareFinder](https://www.taxifarefinder.com/newsroom/2016/04/05/lyft-how-to-calculate-your-fare/)). Measuring Uber over four weeks in San Francisco and Manhattan, Northeastern researchers found surge is set per zone (a jigsaw of areas), updated every 5 minutes, usually lasts under 10 minutes, and strongly reduces demand while barely drawing more drivers ([paper](https://mislove.org/publications/Uber-IMC.pdf), [summary](https://news.northeastern.edu/2015/10/29/northeastern-researchers-unlock-details-of-ubers-surge-pricing-and-suggest-ways-to-avoid-it/)).
- **Upfront pricing.** Since 2016 Uber quotes a price before the trip, predicted from route, time of day and demand. In 2017 its "route-based pricing" used machine learning to estimate what groups of riders would pay for a route and time, so the same trip could cost more from a wealthier neighborhood ([Bloomberg](https://www.bloomberg.com/news/articles/2017-05-19/uber-s-future-may-rely-on-predicting-how-much-you-re-willing-to-pay), [Hoodline](https://hoodline.com/2017/05/uber-s-route-based-pricing-charges-riders-based-on-neighborhood/)).
- **Driver pay is separate.** After Uber's 2023 dynamic pay change, a study of 1.5M UK trips found its cut rose from about 25% to 29%, larger on higher fares ([Oxford](https://www.ox.ac.uk/news/2025-06-23-new-oxford-research-reveals-uber-s-algorithmic-pricing-leaves-drivers-and-passengers), [paper](https://arxiv.org/pdf/2506.15278)). Lyft guarantees drivers at least 70% of rider payments each week, and says they averaged about 88% after external fees ([Lyft](https://www.lyft.com/blog/posts/lyft-expands-driver-earnings-commitment-nationwide)).
- **APIs don't help.** Uber's price-estimate endpoint is restricted to approved partners and its terms forbid competitive price comparison ([Uber docs](https://developer.uber.com/docs/riders/references/api/v1.2/estimates-price-get)). Automated quote collection from their apps would breach their terms.

## The model

```
fare     = max(minimumFare, (baseFare + perMile × miles + perMinute × minutes) × surge + bookingFee)
earnings = fare × driverShare
```

1. **Rate card** for the pickup's market and the ride type. A ride type with no card in a market isn't offered there.
2. **Surge** for the pickup's zone (below). The booking fee isn't surged.
3. **Minimum fare** applies to the total.
4. The rider gets an **upfront quote** with a price per ride type. Booking uses the quote's price if it hasn't expired (2 minutes); otherwise dispatch sends fresh prices to confirm.
5. The **auction** (see `docs/multi-phone-simulator.md`) starts from the quoted fare: its rounds are multiples of it.
6. The driver sees and earns **`driverShare`** (75%) of what the rider pays; the rest is the platform's cut.

Deliberately left out: pricing by predicted willingness to pay, i.e. by who the rider seems to be or where they're coming from. Surge by zone responds to supply and demand; neighborhood-based pricing is the practice that drew criticism, and a basic model doesn't need it.

### Base rates (San Francisco)

Uber no longer publishes rate cards, so these come from third parties.

| Type    | Base  | Per mile | Per minute | Booking fee | Minimum | Source |
| ------- | ----- | -------- | ---------- | ----------- | ------- | ------ |
| UberX   | $2.50 | $1.55    | $0.32      | $3.00       | $7.00   | [RideWise, March 2026](https://getridewise.com/blog/uber-cost-per-mile) (checked against receipts); minimum from [TaxiFareFinder](https://www.taxifarefinder.com/main.php?city=Uber-X-San-Francisco-CA) |
| Comfort | $3.00 | $1.85    | $0.38      | $3.00       | $9.00   | Estimate: scaled from reported national Comfort vs X averages |
| UberXL  | $3.00 | $2.10    | $0.40      | $3.00       | $9.25   | Estimate: [TaxiFareFinder SF](https://www.taxifarefinder.com/main.php?city=Uber-XL-San-Francisco-CA) base and minimum, national per-mile average |
| Black   | $8.00 | $3.75    | $0.60      | $3.00       | $15.00  | Estimate: older SF Black rates and national averages |

Sources disagree: TaxiFareFinder lists older UberX rates of $2.00 + $1.21/mi + $0.22/min. Worth checking against a few real receipts before relying on any of them.

For the simulator's 5 km, 10 minute fixture trip these give UberX $13.52, Comfort $15.55, UberXL $16.52, Black $28.65.

### Base rates (Fairbanks, AK)

From [uphail.com's Fairbanks page](https://uphail.com/us/ak/fairbanks/) (September 2026). Fairbanks lists only UberX and UberXL, so Comfort uses [Anchorage's](https://uphail.com/us/ak/anchorage/) rates from the same source. Neither city lists Black, so Black isn't offered in Fairbanks.

| Type    | Base  | Per mile | Per minute | Booking fee | Minimum | Source |
| ------- | ----- | -------- | ---------- | ----------- | ------- | ------ |
| UberX   | $2.77 | $1.86    | $0.31      | $2.55       | $8.43   | Fairbanks |
| Comfort | $3.74 | $1.92    | $0.40      | $3.58       | $11.75  | Anchorage (substitute) |
| UberXL  | $3.25 | $2.25    | $0.36      | $2.55       | $8.70   | Fairbanks |

Other estimator sites disagree widely for Fairbanks: [taxis-fare.com](https://taxis-fare.com/uber-fare-city-fairbanks-fairbanks-north-star) lists UberX at $2.55 + $1.75/km + $0.35/min, apparently per-mile figures labeled per km, and [taxi-allo.com](https://www.taxi-allo.com/uber-cost-fairbanks-uber-price-alaska-uber-fare-united-states)'s figures don't fit the usual structure. Uphail's are the most complete and match what other searches return, but they're still third-party estimates: check them against real Fairbanks receipts.

For the 5 km, 10 minute fixture trip: UberX $14.20, Comfort $17.29, UberXL $16.39.

### Markets

A market is a center and a radius; a pickup uses the rate cards of the nearest market it's within (`marketFor` in `server/pricing.mts`), or `defaultMarket` if none.

| Market | Center | Radius |
| --- | --- | --- |
| `sf` San Francisco | 37.7749, −122.4194 | 60 km |
| `fairbanks` Fairbanks | 64.8378, −147.7164 | 60 km (includes North Pole and Fort Wainwright) |

The default market is San Francisco, so pickups anywhere else (Anchorage included) get San Francisco prices; that keeps the app usable in development wherever you are. A launch would rather refuse pickups outside its markets.

### Surge

The city is a grid of zones, `zoneSizeDegrees` (0.02°, about 2 km) across. For the pickup's zone:

- **demand** = ride requests from that zone in the last `demandWindowMs` (10 minutes)
- **supply** = drivers there who are connected, driving, and have room for a ride (drivers report their position)
- **multiplier** = 1 + (demand ÷ max(supply, 1) − `threshold`) × `sensitivity`, rounded down to `step` (0.1), between 1 and `maxMultiplier` (3)

With the defaults (threshold 1, sensitivity 0.5): 2 requests for 1 driver → 1.5×; 3 for 1 → 2×; as many requests as drivers → no surge. A zone's multiplier is recomputed at most every `intervalMs` (60 s); the 2015 study measured Uber at 5 minutes. The rider sees "Busy area · prices are 1.5× higher right now".

## Configuring it

Everything above is a setting, since the right values depend on the market:

| Setting | Default |
| --- | --- |
| `markets`, `defaultMarket` | San Francisco and Fairbanks; default `sf` |
| `rateCards` | `{ sf: { x, comfort, xl, black }, fairbanks: { x, comfort, xl } }` |
| `surge` | `{ enabled: true, zoneSizeDegrees: 0.02, intervalMs: 60000, demandWindowMs: 600000, threshold: 1, sensitivity: 0.5, step: 0.1, maxMultiplier: 3 }` |
| `driverShare` | `0.75` |
| `quoteTtlMs` | `120000` |

- **At startup:** `PRICING_FILE=path/to/pricing.json npm run dispatch`, with any subset of the settings; rate cards merge per market and ride type, so a file can adjust one rate or add a market (with its `markets` entry and `rateCards`).
- **Per test:** `POST /test/reset` with `{ "pricing": { ... } }`, or `cy.resetDispatch({ pricing, rates })`.
- **By market:** add a `markets` entry and its `rateCards`; `marketFor(pickup)` picks it for pickups in range.

Tests default to a simple UberX card (`TEST_PRICING` in `cypress/support/e2e.ts`: $2.50 + $0.85/min, so the fixture trip is exactly $11.00) with surge off, so auction scenarios don't depend on the real rates. The `base-rates`, `fairbanks-rates` and `surge-pricing` scenarios cover the real cards, markets and surge.

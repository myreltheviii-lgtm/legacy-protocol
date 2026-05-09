# Mathematical Reference

All on-chain arithmetic uses `u64` with checked operations (`checked_add`, `checked_sub`, `checked_mul`, `checked_div`). All off-chain TypeScript uses `bigint`. Both sides must produce identical results. **Multiply before divide throughout.**

## Inactivity Score Formula

```
score = (elapsed_slots × 100) / threshold_slots
```

Where `elapsed_slots = current_slot - last_check_in_slot`.

Returns 0 when `current_slot ≤ last_check_in_slot` (clock regression guard) or `threshold_slots == 0`.

### Why Multiply Before Divide

Integer division truncates. `(elapsed × 100) / threshold` vs `(elapsed / threshold) × 100`:

```

elapsed = 3,750,001, threshold = 5,000,000
Correct:  (3,750,001 × 100) / 5,000,000 = 375,000,100 / 5,000,000 = 75
Wrong:    (3,750,001 / 5,000,000) × 100 = 0 × 100 = 0
```

The multiply-first order ensures the numerator is as large as possible before truncating.

### Worked Examples (threshold = 5,000,000 slots)

| current_slot | last_check_in_slot | elapsed | score | zone |
|--------------|-------------------|---------|-------|------|
| 0 | 0 | 0 | 0 | Green |
| 2,500,000 | 0 | 2,500,000 | 50 | Green |
| 3,750,000 | 0 | 3,750,000 | 75 | Yellow |
| 4,500,000 | 0 | 4,500,000 | 90 | Orange |
| 5,000,000 | 0 | 5,000,000 | 100 | Red |
| 6,000,000 | 0 | 6,000,000 | 120 | Red |
| 7,500,000 | 0 | 7,500,000 | 150 | Red |
| 1,000,000 | 500,000 | 500,000 | 10 | Green |
| 5,400,000 | 400,000 | 5,000,000 | 100 | Red |

## Zone Classification Table

```

score < 75        → Green  (0–74)
75 ≤ score < 90   → Yellow (75–89)
90 ≤ score < 100  → Orange (90–99)
score ≥ 100       → Red    (100+)
```

Boundary values:
- 74 → Green, 75 → Yellow (transition)
- 89 → Yellow, 90 → Orange (transition)
- 99 → Orange, 100 → Red (transition)

## Milestone Computation

```
warning_75_slot = last_check_in_slot + (threshold × 75) / 100
warning_90_slot = last_check_in_slot + (threshold × 90) / 100
trigger_slot    = last_check_in_slot + threshold
```

All values are absolute slot numbers. Multiply before divide: `(threshold × 75) / 100`, not `threshold / 100 × 75`.

### Worked Example (threshold = 5,000,000, last_check_in_slot = 1,000,000)

```
offset_75       = (5,000,000 × 75) / 100 = 375,000,000 / 100 = 3,750,000
offset_90       = (5,000,000 × 90) / 100 = 450,000,000 / 100 = 4,500,000
warning_75_slot = 1,000,000 + 3,750,000 = 4,750,000
warning_90_slot = 1,000,000 + 4,500,000 = 5,500,000
trigger_slot    = 1,000,000 + 5,000,000 = 6,000,000

```

### Worked Example (threshold = 432,000, last_check_in_slot = 0)

```
offset_75       = (432,000 × 75) / 100 = 32,400,000 / 100 = 324,000
offset_90       = (432,000 × 90) / 100 = 38,880,000 / 100 = 388,800
warning_75_slot = 0 + 324,000  = 324,000
warning_90_slot = 0 + 388,800  = 388,800
trigger_slot    = 0 + 432,000  = 432,000
```

## Anomaly Detection Formula

```
is_anomalous = elapsed > (sum_of_intervals × ANOMALY_MULTIPLIER_PCT) / checkin_count / 100
```

Where `ANOMALY_MULTIPLIER_PCT = 150` (1.5×). The condition is **strictly greater than** (`>`), not `≥`.

Returns `false` when `checkin_count == 0`, `sum_of_intervals == 0`, or `current_slot ≤ last_check_in_slot`.

### Why This Operation Order

The sum is multiplied by the percentage multiplier **before** dividing by `checkin_count`. Dividing by `checkin_count` first (computing the average) and then multiplying by 150 introduces a systematic negative bias: integer truncation on the average is smaller than the true average, so the derived threshold is lower than intended and `anomaly_flag` fires prematurely.

```

Correct (Rust / TypeScript):
  threshold = (sum_of_intervals × 150) / checkin_count / 100

Wrong (divide-first):
  threshold = (sum_of_intervals / checkin_count) × 150 / 100
```

### Worked Example

Owner has checked in 4 times. `sum_of_intervals = 4,000` slots total (average = 1,000 slots per check-in). Current elapsed = 1,501 slots.

```
threshold = (4,000 × 150) / 4 / 100
          = 600,000 / 4 / 100
          = 150,000 / 100
          = 1,500 slots

elapsed > threshold → 1,501 > 1,500 → anomalous = TRUE
```

At exactly the threshold (elapsed = 1,500):
```
1,500 > 1,500 → anomalous = FALSE  (strictly greater than, not ≥)
```

The on-chain Rust and off-chain TypeScript implementations both use this exact multiply-before-divide order, and both use strict `>`. Any deviation between them would cause the watcher to submit `anomaly_flag` transactions that the program then rejects with `ThresholdNotReached` (6010).

## Protocol Constants

All time constants are expressed in slots and wall-clock time (at the approximate Solana mainnet rate of ~2 slots/second).

| Constant | Slots | Approximate wall-clock |
|----------|-------|------------------------|
| `DEFAULT_INACTIVITY_THRESHOLD_SLOTS` | 5,000,000 | ~29 days |
| `MIN_INACTIVITY_THRESHOLD_SLOTS` | 432,000 | ~2.5 days |
| `MAX_INACTIVITY_THRESHOLD_SLOTS` | 157,680,000 | ~2.5 years (913 days) |
| `GUARDIAN_REMOVAL_TIMELOCK_SLOTS` | 216,000 | ~30 hours |
| `BENEFICIARY_CHANGE_TIMELOCK_SLOTS` | 432,000 | ~2.5 days |
| `EMERGENCY_SWEEP_TIMELOCK_SLOTS` | 0 | immediate |
| `GUARDIAN_REMOVAL_COVENANT_TIMELOCK_SLOTS` | 0 | immediate |
| `ANOMALY_MULTIPLIER_PCT` | — | 150 (1.5× average interval) |
| `WARNING_SLOT_PCT_75` | — | 75% |
| `WARNING_SLOT_PCT_90` | — | 90% |

### Slots-to-Days Conversion

```

days = slots / 2 / 86,400
```

`MIN_INACTIVITY_THRESHOLD_SLOTS` example:
```
432,000 / 2 / 86,400 = 2.5 days
```

Note: when configuring the threshold via the frontend or SDK using whole-day inputs, the minimum integer-day value that meets the on-chain minimum is **3 days** (3 × 86,400 × 2 = 518,400 slots ≥ 432,000). An input of 2 days would produce 345,600 slots which falls below the minimum and is rejected by the program with `ThresholdTooLow` (6008).

## TypeScript Parity

The SDK's `sdk/src/math.ts` must be bit-identical to `programs/legacy_vault/src/math/`. Verified parity points:

| Operation | Rust | TypeScript |
|-----------|------|------------|
| Score | `(elapsed * 100) / threshold` | `(elapsed * 100n) / inactivityThresholdSlots` |
| Milestone 75% | `(threshold * 75) / 100` | `(inactivityThresholdSlots * 75n) / 100n` |
| Anomaly threshold | `(sum * 150) / count / 100` | `(sumOfIntervals * 150n) / checkinCount / 100n` |
| Threshold crossed | `current_slot >= last + threshold` | `currentSlot >= lastCheckInSlot + inactivityThresholdSlots` |

All use `bigint` in TypeScript. `Number` loses precision above 2^53 — Solana slot numbers in production exceed this bound. Using `Number` for slot arithmetic would introduce systematic errors.
```


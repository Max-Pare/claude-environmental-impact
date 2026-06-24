---
name: eco
description: >
  Tracks estimated LLM session resource consumption: power (Wh), cooling water (mL),
  CO₂ emissions (g), and heat generated (kJ). Shows two rows — real-time inference
  only, and total including amortized datacenter infrastructure. Use /eco to
  activate/deactivate. When active, appends an eco impact block after each response.
  Delivered by the UserPromptSubmit hook; model does not need to compute the numbers.
---

This skill is delivered by `src/hooks/eco-tracker.js`.

## Usage

- `/eco` — toggle on/off. Shows current session stats when activating.
- `/eco off` — deactivate explicitly.

## What gets measured

Each response, the hook reads the session transcript to tally tokens (output +
input + cache-read), then computes:

| Metric | Model |
|--------|-------|
| Power  | H100 SXM inference × server overhead × PUE 1.5 |
| Water  | 1.8 L/kWh evaporative cooling (IEA 2024) |
| CO₂    | 386 g/kWh US grid average (EPA eGRID 2022) |
| Heat   | 3.6 kJ/Wh (all electrical energy → heat) |

**Real-time row**: inference only.  
**Infrastructure row**: real-time × 1.5 (amortized training + hardware manufacturing).

Numbers are rough order-of-magnitude estimates. The goal is honesty, not false precision.

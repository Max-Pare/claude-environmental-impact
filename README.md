# claude-environmental-impact — Claude Code Eco Tracker Plugin

Tracks the estimated environmental footprint of your Claude Code sessions in real time: power draw, cooling water, CO₂ emissions, and heat generated.

---

## Installation

```bash
claude plugin install https://github.com/Max-Pare/claude-environmental-impact
```

Or clone and install locally:

```bash
git clone https://github.com/Max-Pare/claude-environmental-impact
claude plugin install ./claude-environmental-impact
```

---

## Commands

| Command | What it does |
|---------|-------------|
| `/eco` | Toggle eco tracking on/off. Shows current session stats on activation. |
| `/eco off` | Deactivate explicitly (also: "stop eco", "disable eco", "turn off eco"). |
| `/eco visual` | ASCII visual of current session impact (glasses of water, laptop charges, AC hours). |
| `/eco manual` | Interactive wizard — enter a token count, pick an AI and model, get a visual estimate. Useful for estimating cost of sessions you weren't tracking. |

### `/eco manual` wizard flow

```
/eco manual
→ How many total tokens?      e.g. 50000
→ Which AI?                   chatgpt / claude / gemini / llama / mistral / grok  (or "skip")
→ Which model?                e.g. gpt-4o, claude-sonnet-4, gemini-2.5-pro        (or "skip")
→ Visual output
```

Type `cancel` at any step to abort.

---

## What gets measured

When active, an eco block is appended after every response:

```
─── 🌱 Eco Impact (~12K tokens, 8 turns) ──────────────────────────────
                       Power         Water         CO₂           Heat
Real-time inference:   0.027 Wh      0.049 mL      0.010 g       0.097 kJ
Incl. infrastructure:  0.041 Wh      0.073 mL      0.016 g       0.146 kJ
─────────────────────────────────────────────────────────────────────────
Est: H100 + PUE 1.5 | US grid 386g CO₂/kWh | 1.8L water/kWh | infra = 1.5× inference
```

| Metric | Model |
|--------|-------|
| Power | H100 SXM 700W, ~1000 tok/s, ×1.3 server overhead, ×1.5 PUE |
| Water | 1.8 L/kWh evaporative cooling (IEA 2024) |
| CO₂ | 386 g/kWh US grid average (EPA eGRID 2022, no renewable credit) |
| Heat | 3.6 kJ/Wh (electrical energy → heat) |

**Real-time row**: inference only.  
**Infrastructure row**: ×1.5 — amortized training and hardware manufacturing.

Numbers are order-of-magnitude estimates. The goal is honesty, not false precision.

### Supported AIs (for `/eco manual`)

`chatgpt` · `claude` · `gemini` · `llama` · `mistral` · `grok`

Each AI has per-model coefficients. Fuzzy matching works — `sonnet`, `4o`, `flash` all resolve correctly.

---

## Sources

- IEA (2024) — *Electricity 2024*, water intensity estimates
- EPA eGRID (2022) — US average grid carbon intensity
- Goldman Sachs (2024) — *AI's Growing Footprint*
- H100 SXM specs — NVIDIA

---

## License

MIT

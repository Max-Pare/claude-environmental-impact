<h1>What is this?</h1>
A tool to get a rough estimation of the environmental impact your Claude session has.
Hypocritically written with the assistance of Claude.

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
| `/eco` | Toggle eco tracking on/off. Activates in **visual mode** (no ASCII art) by default. |
| `/eco off` | Deactivate explicitly (also: "stop eco", "disable eco", "turn off eco"). |
| `/eco visual` | When eco is **on**: toggle between visual and compact table mode. When eco is **off**: one-shot visual of current session. |
| `/eco art` | Toggle ASCII art on/off within visual mode (glasses, laptop charges, AC hours). Off by default. |
| `/eco manual` | Interactive wizard — enter a token count, pick an AI and model, get a visual estimate. Useful for estimating cost of sessions you weren't tracking. |

### Visual modes

By default, `/eco` activates in **visual mode without ASCII art** — shows water/power/CO₂ as comparable real-world quantities (e.g. "3.2 glasses", "0.1 laptop charges") without the tile drawings.

- `/eco art` — enable ASCII art tiles (glasses, laptops, AC units)
- `/eco visual` — switch back to compact table mode (or toggle visual back on)

### `/eco manual` wizard flow

```
/eco manual
→ How many total tokens?      e.g. 50000, 43k, 10.0M
→ Which AI?                   chatgpt / claude / gemini / llama / mistral / grok  (or "skip")
→ Which model?                e.g. gpt-4o, claude-sonnet-4, gemini-2.5-pro        (or "skip")
→ Visual output
```

Type `cancel` at any step to abort. Token input accepts `k`/`K` (×1000) and `m`/`M` (×1 000 000) suffixes.

---

## What gets measured

When active, an eco block is appended after every response. Default output (visual mode, no art):

```
───  Eco Visual  (~12K tokens, 8 turns) ────────────────────────────────────

💧 WATER  ·  1 glass = 250 mL
   inference only:        0.049 mL  ≈  0.0 glasses
   incl. infrastructure:  0.073 mL  ≈  0.0 glasses

⚡ POWER  ·  1 laptop = 60 Wh (full charge, avg laptop)
   inference only:        0.027 Wh  ≈  0.0 charges
   incl. infrastructure:  0.041 Wh  ≈  0.0 charges

❄️  AC HOURS  ·  1 unit = 1000 Wh/h (avg single split, ~1 kW / 9000–12000 BTU)
   inference only:        0.027 Wh  ≈  0.0 hours
   incl. infrastructure:  0.041 Wh  ≈  0.0 hours

───────────────────────────────────────────────────────────────────────
```

With `/eco art` enabled, ASCII tile art (glasses, laptops, AC units) is added between each row. Use `/eco visual` to switch to the compact table instead:

```
───  Eco Impact (~12K tokens, 8 turns) ──────────────────────────────
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

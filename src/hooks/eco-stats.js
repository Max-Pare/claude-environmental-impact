#!/usr/bin/env node
// eco-stats.js — core resource calculator for LLM inference
//
// EMPIRICAL SOURCES:
//   Power:   H100 SXM at 700W, ~1000 tok/s generation for ~70B models.
//            700W ÷ 1000 tok/s = 0.7 Wh/1K tokens (GPU only).
//            × server overhead 1.3 (CPU/RAM/NVLink) × PUE 1.5 (hyperscale DC)
//            = 1.365 → rounded to 1.5 Wh/1K output tokens.
//            Prefill (input) ~10× faster → 0.15 Wh/1K input tokens.
//            Published range: IEA 2024 estimates 1–12.5 Wh/1K; GS 2024 ~3.75 Wh/1K.
//            1.5 Wh/1K sits at the conservative (low) end of that range.
//   Water:   Evaporative cooling averages ~1.8 L/kWh (IEA 2024, AWS reports).
//   CO₂:     US average grid intensity 386 g/kWh (EPA eGRID 2022).
//            Anthropic on AWS us-east-1 with ~50% renewable coverage;
//            actual ~200–250 g/kWh; we use US average for honest worst-case.
//   Infra:   Amortized training (GPT-4 scale: ~1287 MWh once / ~10¹² tokens
//            lifetime) + hardware manufacturing (~100 kg CO₂e per H100, 3yr).
//            Adds ~15–20% to per-token operational cost → rounded to 1.5×.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const EMPIRICAL = {
  WH_PER_1K_OUTPUT : 1.50,   // Wh per 1K output tokens (H100 700W, 1K tok/s, ×1.3 overhead, ×1.5 PUE)
  WH_PER_1K_INPUT  : 0.15,   // Wh per 1K input tokens (prefill ~10× faster)
  ML_WATER_PER_KWH : 1800,   // mL cooling water per kWh
  G_CO2_PER_KWH    : 386,    // g CO₂ per kWh (US grid, no renewable credit)
  INFRA_MULTIPLIER : 1.5,    // amortized training + hardware mfg overhead
};

function calcResources(tokens, includeInfra) {
  const { outputTokens = 0, inputTokens = 0, cacheReadTokens = 0 } = tokens;
  const mult = includeInfra ? EMPIRICAL.INFRA_MULTIPLIER : 1;

  const whOut  = (outputTokens / 1000) * EMPIRICAL.WH_PER_1K_OUTPUT;
  const whIn   = ((inputTokens + cacheReadTokens) / 1000) * EMPIRICAL.WH_PER_1K_INPUT;
  const wh     = (whOut + whIn) * mult;
  const kwh    = wh / 1000;

  return {
    wh,
    mlWater : kwh * EMPIRICAL.ML_WATER_PER_KWH,
    gCO2    : kwh * EMPIRICAL.G_CO2_PER_KWH,
    kj      : wh * 3.6,
  };
}

function parseSession(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch { return { outputTokens: 0, inputTokens: 0, cacheReadTokens: 0, turns: 0 }; }

  let outputTokens = 0, inputTokens = 0, cacheReadTokens = 0, turns = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const u = entry.message.usage;
    if (!u) continue;
    outputTokens    += u.output_tokens            || 0;
    inputTokens     += u.input_tokens             || 0;
    cacheReadTokens += u.cache_read_input_tokens  || 0;
    turns++;
  }
  return { outputTokens, inputTokens, cacheReadTokens, turns };
}

function findRecentSession(claudeDir) {
  const projectsDir = path.join(claudeDir, 'projects');
  let entries;
  try { entries = fs.readdirSync(projectsDir, { withFileTypes: true }); }
  catch { return null; }

  let best = null;
  const stack = entries.map(e => path.join(projectsDir, e.name));
  while (stack.length) {
    const p = stack.pop();
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      try { for (const c of fs.readdirSync(p)) stack.push(path.join(p, c)); } catch {}
    } else if (p.endsWith('.jsonl') && (!best || st.mtimeMs > best.mtime)) {
      best = { file: p, mtime: st.mtimeMs };
    }
  }
  return best ? best.file : null;
}

function fmtVal(n) {
  if (!Number.isFinite(n) || n < 0.0005) return '~0';
  if (n < 1)   return n.toFixed(3);
  if (n < 10)  return n.toFixed(2);
  if (n < 100) return n.toFixed(1);
  return n.toFixed(0);
}

function col(n, unit, width) {
  const s = `${fmtVal(n)} ${unit}`;
  return s.padEnd(width);
}

function humanizeTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1000) + 'K';
  return String(n);
}

function formatEcoBlock(tokens) {
  const total = tokens.outputTokens + tokens.inputTokens + tokens.cacheReadTokens;
  const rt   = calcResources(tokens, false);
  const full = calcResources(tokens, true);

  const W = 13;
  const sep = '─'.repeat(69);
  return [
    ``,
    `─── 🌱 Eco Impact (~${humanizeTokens(total)} tokens, ${tokens.turns} turns) ${'─'.repeat(30)}`,
    `                       ${'Power'.padEnd(W)} ${'Water'.padEnd(W)} ${'CO₂'.padEnd(W)} Heat`,
    `Real-time inference:   ${col(rt.wh,   'Wh',  W)} ${col(rt.mlWater,   'mL', W)} ${col(rt.gCO2,   'g', W)} ${fmtVal(rt.kj)} kJ`,
    `Incl. infrastructure:  ${col(full.wh, 'Wh',  W)} ${col(full.mlWater, 'mL', W)} ${col(full.gCO2, 'g', W)} ${fmtVal(full.kj)} kJ`,
    sep,
    `Est: H100 + PUE 1.5 | US grid 386g CO₂/kWh | 1.8L water/kWh | infra = 1.5× inference`,
  ].join('\n');
}

// ── Visual summary helpers ──────────────────────────────────────────────────

function makeGlass(fill) {
  // 5-wide, 5-tall ASCII drinking glass. Water fills from bottom.
  // 3 content rows; partial capped at ROWS-1 so partial ≠ full visually.
  const ROWS = 3;
  const filledRows = fill >= 1.0 ? ROWS : Math.min(ROWS - 1, Math.ceil(fill * ROWS));
  const art = ['┌───┐'];
  for (let row = ROWS - 1; row >= 0; row--) {
    art.push(`│${row < filledRows ? '░░░' : '   '}│`);
  }
  art.push('└───┘');
  return art; // 5 lines
}

function makeLaptop(fill) {
  // 7-wide, 6-tall ASCII laptop. Battery fills from bottom of screen area.
  // 3 content rows; partial capped at ROWS-1 so partial ≠ full visually.
  const ROWS = 3;
  const filledRows = fill >= 1.0 ? ROWS : Math.min(ROWS - 1, Math.ceil(fill * ROWS));
  const art = ['┌─────┐'];
  for (let row = ROWS - 1; row >= 0; row--) {
    art.push(`│${row < filledRows ? '░░░░░' : '     '}│`);
  }
  art.push('└──┬──┘');
  art.push(' ──┴── ');
  return art; // 6 lines
}

function makeAC(fill) {
  // 8-wide, 5-tall ASCII wall-mount split AC unit. Cooling fill from bottom.
  // 3 content rows; partial capped at ROWS-1 so partial ≠ full visually.
  const ROWS = 3;
  const filledRows = fill >= 1.0 ? ROWS : Math.min(ROWS - 1, Math.ceil(fill * ROWS));
  const art = ['┌──────┐'];
  for (let row = ROWS - 1; row >= 0; row--) {
    art.push(`│${row < filledRows ? '≈≈≈≈≈≈' : '      '}│`);
  }
  art.push('└──────┘');
  return art; // 5 lines
}

function tileArt(items, perRow, rowHeight) {
  if (!items.length) return '  (none)';
  const lines = [];
  for (let i = 0; i < items.length; i += perRow) {
    const chunk = items.slice(i, i + perRow);
    for (let r = 0; r < rowHeight; r++) {
      lines.push(chunk.map(item => item[r]).join(' '));
    }
    if (i + perRow < items.length) lines.push('');
  }
  return lines.join('\n');
}

function buildArtSection(totalUnits, makeItemFn, perRow, rowHeight) {
  const MAX = 24;
  const full = Math.floor(totalUnits);
  const frac = totalUnits - full;
  const totalItems = full + (frac > 0.05 ? 1 : 0);
  const showCount  = Math.min(totalItems, MAX);
  const items = [];
  for (let i = 0; i < showCount; i++) {
    const isFrac = (i === full) && (frac > 0.05);
    items.push(makeItemFn(isFrac ? frac : 1.0));
  }
  return { art: tileArt(items, perRow, rowHeight), hidden: totalItems - showCount };
}

function formatVisual(tokens) {
  const total = tokens.outputTokens + tokens.inputTokens + tokens.cacheReadTokens;
  const rt   = calcResources(tokens, false);
  const full = calcResources(tokens, true);

  const ML_PER_GLASS  = 250;
  const WH_PER_LAPTOP = 60;    // typical laptop full charge (MacBook Air ~49 Wh, average ~60 Wh)
  const WH_PER_AC_HOUR = 1000; // avg single split AC unit ~1 kW (9000–12000 BTU)

  const rtWater   = buildArtSection(rt.mlWater / ML_PER_GLASS,     makeGlass,  8, 5);
  const fullWater = buildArtSection(full.mlWater / ML_PER_GLASS,   makeGlass,  8, 5);
  const rtPower   = buildArtSection(rt.wh / WH_PER_LAPTOP,         makeLaptop, 6, 6);
  const fullPower = buildArtSection(full.wh / WH_PER_LAPTOP,       makeLaptop, 6, 6);
  const rtAC      = buildArtSection(rt.wh / WH_PER_AC_HOUR,        makeAC,     5, 5);
  const fullAC    = buildArtSection(full.wh / WH_PER_AC_HOUR,      makeAC,     5, 5);

  function cntStr(n, unit) {
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${unit}`;
  }

  const SEP = '─'.repeat(69);
  const out = [];
  out.push('');
  out.push(`─── 🌱 Eco Visual  (~${humanizeTokens(total)} tokens, ${tokens.turns} turns) ${'─'.repeat(28)}`);

  out.push('');
  out.push(`💧 WATER  ·  1 glass = ${ML_PER_GLASS} mL`);
  out.push(`   inference only:        ${fmtVal(rt.mlWater)} mL  ≈  ${cntStr(rt.mlWater / ML_PER_GLASS, 'glasses')}`);
  out.push(rtWater.art);
  if (rtWater.hidden) out.push(`  ··· +${rtWater.hidden} more glasses`);
  out.push(`   incl. infrastructure:  ${fmtVal(full.mlWater)} mL  ≈  ${cntStr(full.mlWater / ML_PER_GLASS, 'glasses')}`);
  out.push(fullWater.art);
  if (fullWater.hidden) out.push(`  ··· +${fullWater.hidden} more glasses`);

  out.push('');
  out.push(`⚡ POWER  ·  1 laptop = ${WH_PER_LAPTOP} Wh (full charge, avg laptop)`);
  out.push(`   inference only:        ${fmtVal(rt.wh)} Wh  ≈  ${cntStr(rt.wh / WH_PER_LAPTOP, 'charges')}`);
  out.push(rtPower.art);
  if (rtPower.hidden) out.push(`  ··· +${rtPower.hidden} more charges`);
  out.push(`   incl. infrastructure:  ${fmtVal(full.wh)} Wh  ≈  ${cntStr(full.wh / WH_PER_LAPTOP, 'charges')}`);
  out.push(fullPower.art);
  if (fullPower.hidden) out.push(`  ··· +${fullPower.hidden} more charges`);

  out.push('');
  out.push(`❄️  AC HOURS  ·  1 unit = ${WH_PER_AC_HOUR} Wh/h (avg single split, ~1 kW / 9000–12000 BTU)`);
  out.push(`   inference only:        ${fmtVal(rt.wh)} Wh  ≈  ${cntStr(rt.wh / WH_PER_AC_HOUR, 'hours')}`);
  out.push(rtAC.art);
  if (rtAC.hidden) out.push(`  ··· +${rtAC.hidden} more hours`);
  out.push(`   incl. infrastructure:  ${fmtVal(full.wh)} Wh  ≈  ${cntStr(full.wh / WH_PER_AC_HOUR, 'hours')}`);
  out.push(fullAC.art);
  if (fullAC.hidden) out.push(`  ··· +${fullAC.hidden} more hours`);

  out.push('');
  out.push(SEP);
  return out.join('\n');
}

module.exports = { parseSession, findRecentSession, calcResources, formatEcoBlock, formatVisual, EMPIRICAL };

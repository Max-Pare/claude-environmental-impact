#!/usr/bin/env node
// eco-tracker.js — UserPromptSubmit hook
//
// /eco            → toggle eco mode on/off
// /eco off        → deactivate
// /eco visual     → ASCII visual summary of current session
// /eco manual     → interactive wizard: token count → AI → model → visual
// active mode     → inject additionalContext instructing model to append eco block

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const {
  parseSession, parseProjectDir, findRecentSession,
  formatEcoBlock, formatVisual, formatVisualManual,
  AI_MODELS,
} = require('./eco-stats');

const claudeDir       = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath        = path.join(claudeDir, '.eco-active');
const visualFlagPath  = path.join(claudeDir, '.eco-visual');
const artFlagPath     = path.join(claudeDir, '.eco-art');
const manualStatePath = path.join(claudeDir, '.eco-manual-state');

// ── eco active flag ────────────────────────────────────────────────────────
function isEcoActive()  { try { fs.accessSync(flagPath); return true; }       catch { return false; } }
function isEcoVisual()  { try { fs.accessSync(visualFlagPath); return true; } catch { return false; } }
function isEcoArt()     { try { fs.accessSync(artFlagPath); return true; }    catch { return false; } }

function setFlag(p, on) {
  if (on) { try { fs.writeFileSync(p, '1', 'utf8'); } catch {} }
  else    { try { fs.unlinkSync(p); } catch {} }
}

function setEcoActive(on) {
  setFlag(flagPath, on);
  if (on)  { setFlag(visualFlagPath, true); }  // visual ON by default
  if (!on) { setFlag(visualFlagPath, false); setFlag(artFlagPath, false); }
}

// ── manual wizard state ────────────────────────────────────────────────────
function getManualState() {
  try { return JSON.parse(fs.readFileSync(manualStatePath, 'utf8')); } catch { return null; }
}
function setManualState(s) {
  try { fs.writeFileSync(manualStatePath, JSON.stringify(s), 'utf8'); } catch {}
}
function clearManualState() {
  try { fs.unlinkSync(manualStatePath); } catch {}
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function parseTokenInput(s) {
  const clean = s.replace(/[,_\s]/g, '');
  const m = clean.match(/^([0-9]*\.?[0-9]+)\s*([kKmM]?)$/);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  if (m[2] === 'k' || m[2] === 'K') n *= 1e3;
  if (m[2] === 'm' || m[2] === 'M') n *= 1e6;
  return Math.round(n);
}

function getTokens(data) {
  const file = data.transcript_path || findRecentSession(claudeDir);
  if (!file) return null;
  return parseProjectDir(file);
}

// Build the AI selection menu string
function aiMenu() {
  return Object.entries(AI_MODELS)
    .map(([k, v]) => `  ${k.padEnd(10)} ${v.name}`)
    .join('\n');
}

// Build the model selection menu for a given AI key
function modelMenu(aiKey) {
  const ai = AI_MODELS[aiKey];
  return Object.entries(ai.models)
    .map(([k, v]) => `  ${k.padEnd(20)} ${v.label}`)
    .join('\n');
}

// Fuzzy-match a user string against keys (exact, prefix, suffix, substring)
function matchKey(input, keys) {
  const clean = s => s.toLowerCase().replace(/[-_\s.]/g, '');
  const c = clean(input);
  return (
    keys.find(k => clean(k) === c) ||
    keys.find(k => clean(k).startsWith(c)) ||
    keys.find(k => clean(k).endsWith(c)) ||
    keys.find(k => clean(k).includes(c) || c.includes(clean(k)))
  );
}

// ── main ───────────────────────────────────────────────────────────────────
let rawInput = '';
process.stdin.on('data', chunk => { rawInput += chunk; });
process.stdin.on('end', () => {
  try {
    const data   = JSON.parse(rawInput);
    const prompt = (data.prompt || '').trim();

    // ── wizard in progress: intercept next user message ────────────────────
    const state = getManualState();
    if (state) {
      const ans = prompt.trim();

      if (/^cancel$/i.test(ans)) {
        clearManualState();
        block(' Manual calculator cancelled.');
        return;
      }

      if (state.step === 'tokens') {
        const n = parseTokenInput(ans);
        if (isNaN(n) || n <= 0) {
          block(`Invalid: "${ans}"\nEnter a number (e.g. 50000, 43k, 10.0M), or "cancel":`);
          return;
        }
        setManualState({ step: 'ai', tokens: n });
        block(
          `Tokens: ${n.toLocaleString()}\n\n` +
          `Which AI? (or "skip" for global estimate, "cancel" to abort)\n` +
          aiMenu()
        );
        return;
      }

      if (state.step === 'ai') {
        if (/^skip$/i.test(ans)) {
          clearManualState();
          block(formatVisualManual(state.tokens, null, null));
          return;
        }
        const aiKey = matchKey(ans, Object.keys(AI_MODELS));
        if (!aiKey) {
          block(
            `Unknown AI: "${ans}"\nChoose one of: ${Object.keys(AI_MODELS).join(', ')}  ·  or "skip" / "cancel"\n` +
            aiMenu()
          );
          return;
        }
        setManualState({ step: 'model', tokens: state.tokens, ai: aiKey });
        block(
          `Tokens: ${state.tokens.toLocaleString()}  ·  AI: ${AI_MODELS[aiKey].name}\n\n` +
          `Which model? (or "skip" for ${AI_MODELS[aiKey].name} average, "cancel" to abort)\n` +
          modelMenu(aiKey)
        );
        return;
      }

      if (state.step === 'model') {
        clearManualState();
        let modelKey = null;
        if (!/^skip$/i.test(ans)) {
          modelKey = matchKey(ans, Object.keys(AI_MODELS[state.ai].models));
          if (!modelKey) {
            // Unknown model: fall back to AI default, note it
            block(
              formatVisualManual(state.tokens, state.ai, null) +
              `\n(Model "${ans}" not recognised — used ${AI_MODELS[state.ai].name} average.)`
            );
            return;
          }
        }
        block(formatVisualManual(state.tokens, state.ai, modelKey));
        return;
      }
    }

    // ── /eco manual ────────────────────────────────────────────────────────
    if (/^\/eco(?::eco)?\s+manual\b/i.test(prompt)) {
      setManualState({ step: 'tokens' });
      block(
        ' Eco Manual Calculator\n' +
        '─────────────────────────────────────────\n' +
        'How many total tokens? (input + output combined)\n' +
        'Enter a number (e.g. 50000, 43k, 10.0M), or "cancel" to abort.'
      );
      return;
    }

    // ── /eco art ───────────────────────────────────────────────────────────
    if (/^\/eco(?::eco)?\s+art\b/i.test(prompt)) {
      const on = !isEcoArt();
      setFlag(artFlagPath, on);
      const tokens = getTokens(data);
      let body = on ? ' ASCII art ON.' : ' ASCII art OFF.';
      if (on && tokens && tokens.turns > 0) body += formatVisual(tokens, { noArt: false });
      block(body);
      return;
    }

    // ── /eco visual ────────────────────────────────────────────────────────
    if (/^\/eco(?::eco)?\s+(visual|vis|v)\b/i.test(prompt)) {
      if (isEcoActive()) {
        // toggle visual mode when eco is running
        const on = !isEcoVisual();
        setFlag(visualFlagPath, on);
        const tokens = getTokens(data);
        let body = on ? ' Visual mode ON.' : ' Visual mode OFF (compact table).';
        if (on && tokens && tokens.turns > 0) body += formatVisual(tokens, { noArt: !isEcoArt() });
        block(body);
      } else {
        // one-shot when eco is off
        const tokens = getTokens(data);
        if (!tokens || tokens.turns === 0) {
          block(' No turns yet — run a few prompts first.');
        } else {
          block(formatVisual(tokens, { noArt: !isEcoArt() }));
        }
      }
      return;
    }

    // ── /eco off / toggle ─────────────────────────────────────────────────
    const isEcoOff = /^\/eco(?::eco)?\s+off$/i.test(prompt) ||
                     /\b(stop|disable|deactivate|turn off)\s+eco\b/i.test(prompt);
    const isEcoCmd = /^\/eco(?::eco)?(?:\s+.*)?$/i.test(prompt);

    if (isEcoCmd || isEcoOff) {
      const active = isEcoActive();
      if (isEcoOff || active) {
        setEcoActive(false);
        const tokens = getTokens(data);
        let body = ' Eco tracker deactivated.';
        if (tokens && tokens.turns > 0) body += '\n\nFinal session impact:' + formatEcoBlock(tokens);
        block(body);
      } else {
        setEcoActive(true);
        const tokens = getTokens(data);
        let body = ' Eco tracker activated. Visual mode ON (no art). Use /eco art to enable ASCII art, /eco visual to switch to compact table.\n';
        if (tokens && tokens.turns > 0) body += '\nCurrent session:' + formatVisual(tokens, { noArt: true });
        else body += '\nNo turns yet — first eco block will appear after this response.';
        block(body);
      }
      return;
    }

    // ── auto-append when active ────────────────────────────────────────────
    if (isEcoActive()) {
      const tokens = getTokens(data);
      if (tokens && tokens.turns > 0) {
        const ecoBlock = isEcoVisual()
          ? formatVisual(tokens, { noArt: !isEcoArt() })
          : formatEcoBlock(tokens);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext:
              'ECO TRACKER ACTIVE. You MUST copy the following block verbatim ' +
              'at the very end of your response, after a blank line. ' +
              'Do not modify, summarize, or omit it:\n' + ecoBlock,
          },
        }));
      }
    }
  } catch (_) {
    // silent fail — never crash the session
  }
});

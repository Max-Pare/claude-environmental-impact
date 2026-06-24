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
  parseSession, findRecentSession,
  formatEcoBlock, formatVisual, formatVisualManual,
  AI_MODELS,
} = require('./eco-stats');

const claudeDir      = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath       = path.join(claudeDir, '.eco-active');
const manualStatePath = path.join(claudeDir, '.eco-manual-state');

// ── eco active flag ────────────────────────────────────────────────────────
function isEcoActive() {
  try { fs.accessSync(flagPath); return true; } catch { return false; }
}
function setEcoActive(on) {
  if (on) { try { fs.writeFileSync(flagPath, '1', 'utf8'); } catch {} }
  else    { try { fs.unlinkSync(flagPath); } catch {} }
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

function getTokens(data) {
  const file = data.transcript_path || findRecentSession(claudeDir);
  if (!file) return null;
  return parseSession(file);
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
        const n = parseInt(ans.replace(/[,_\s]/g, ''), 10);
        if (isNaN(n) || n <= 0) {
          block(`Invalid: "${ans}"\nEnter a positive integer (e.g. 50000), or "cancel":`);
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
        'Enter a number, or "cancel" to abort.'
      );
      return;
    }

    // ── /eco visual ────────────────────────────────────────────────────────
    if (/^\/eco(?::eco)?\s+(visual|vis|v)\b/i.test(prompt)) {
      const tokens = getTokens(data);
      if (!tokens || tokens.turns === 0) {
        block(' No turns yet — run a few prompts first.');
      } else {
        block(formatVisual(tokens));
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
        let body = ' Eco tracker activated. Impact will be appended after each response.\n';
        if (tokens && tokens.turns > 0) body += '\nCurrent session:' + formatEcoBlock(tokens);
        else body += '\nNo turns yet — first eco block will appear after this response.';
        block(body);
      }
      return;
    }

    // ── auto-append when active ────────────────────────────────────────────
    if (isEcoActive()) {
      const tokens = getTokens(data);
      if (tokens && tokens.turns > 0) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext:
              'ECO TRACKER ACTIVE. You MUST copy the following block verbatim ' +
              'at the very end of your response, after a blank line. ' +
              'Do not modify, summarize, or omit it:\n' + formatEcoBlock(tokens),
          },
        }));
      }
    }
  } catch (_) {
    // silent fail — never crash the session
  }
});

#!/usr/bin/env node
// eco-tracker.js — UserPromptSubmit hook
//
// /eco          → toggle eco mode on/off, show current session stats
// /eco off      → deactivate (also: "stop eco", "disable eco")
// active mode   → inject additionalContext instructing model to append eco block

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { parseSession, findRecentSession, formatEcoBlock, formatVisual } = require('./eco-stats');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const flagPath  = path.join(claudeDir, '.eco-active');

function isEcoActive() {
  try { fs.accessSync(flagPath); return true; } catch { return false; }
}

function setEcoActive(on) {
  if (on) {
    try { fs.writeFileSync(flagPath, '1', 'utf8'); } catch {}
  } else {
    try { fs.unlinkSync(flagPath); } catch {}
  }
}

function getTokens(data) {
  const file = data.transcript_path || findRecentSession(claudeDir);
  if (!file) return null;
  return parseSession(file);
}

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data   = JSON.parse(input);
    const prompt = (data.prompt || '').trim();

    const isEcoVisual = /^\/eco(?::eco)?\s+(visual|vis|v)\b/i.test(prompt);
    const isEcoCmd    = /^\/eco(?::eco)?(?:\s+(.*))?$/i.test(prompt);
    const isEcoOff    = /^\/eco(?::eco)?\s+off$/i.test(prompt) ||
                        /\b(stop|disable|deactivate|turn off)\s+eco\b/i.test(prompt);

    if (isEcoVisual) {
      const tokens = getTokens(data);
      if (!tokens || tokens.turns === 0) {
        process.stdout.write(JSON.stringify({ decision: 'block', reason: '🌱 No turns yet — run a few prompts first.' }));
      } else {
        process.stdout.write(JSON.stringify({ decision: 'block', reason: formatVisual(tokens) }));
      }
      return;
    }

    if (isEcoCmd || isEcoOff) {
      const active = isEcoActive();

      if (isEcoOff || active) {
        setEcoActive(false);
        const tokens = getTokens(data);
        let body = '🌱 Eco tracker deactivated.';
        if (tokens && tokens.turns > 0) {
          body += '\n\nFinal session impact:' + formatEcoBlock(tokens);
        }
        process.stdout.write(JSON.stringify({ decision: 'block', reason: body }));
      } else {
        setEcoActive(true);
        const tokens = getTokens(data);
        let body = '🌱 Eco tracker activated. Impact will be appended after each response.\n';
        if (tokens && tokens.turns > 0) {
          body += '\nCurrent session:' + formatEcoBlock(tokens);
        } else {
          body += '\nNo turns yet — first eco block will appear after this response.';
        }
        process.stdout.write(JSON.stringify({ decision: 'block', reason: body }));
      }
      return;
    }

    if (isEcoActive()) {
      const tokens = getTokens(data);
      if (tokens && tokens.turns > 0) {
        const block = formatEcoBlock(tokens);
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext:
              'ECO TRACKER ACTIVE. You MUST copy the following block verbatim ' +
              'at the very end of your response, after a blank line. ' +
              'Do not modify, summarize, or omit it:\n' + block,
          },
        }));
      }
    }
  } catch (_) {
    // silent fail — never crash the session
  }
});

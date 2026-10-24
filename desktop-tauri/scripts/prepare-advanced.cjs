'use strict';

// Extract presentation only from the active Electron workbench. None of its
// runtime, file APIs or event handlers are executed by the Tauri shell.
function one(source, expression, name) {
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) throw new Error(`Original advanced tools ${name} moved; review extraction`);
  return matches[0][1];
}

function composeAdvanced(source) {
  const styles = one(source, /function ensureStyles\(doc = document\) \{([\s\S]*?)\n  \}/g, 'styles');
  const shell = one(source, /function ensureShell\(doc = document\) \{([\s\S]*?)\n  \}/g, 'shell');
  const css = one(styles, /style\.textContent = `([^`]*)`;/g, 'CSS literal');
  const markup = one(shell, /overlay\.innerHTML = '([^']*)';/g, 'HTML literal');
  const id = one(shell, /overlay\.id = '([^']*)';/g, 'overlay ID');
  const classes = one(shell, /overlay\.className = '([^']*)';/g, 'overlay classes');
  if (id !== 'advanced-tools-overlay' || classes !== 'overlay hidden'
    || !markup.includes('id="at-title"') || !markup.includes('id="at-subtitle"') || !markup.includes('id="at-body"')
    || /\\|\$\{|<script\b|\son[a-z]+\s*=|\sstyle\s*=|(?:src|href)\s*=/i.test(markup)
    || /\\|\$\{|<\/style|@import|url\s*\(/i.test(css)) {
    throw new Error('Unreviewed original advanced tools presentation');
  }
  return { html: `<div id="${id}" class="${classes}">${markup}</div>`, css };
}

module.exports = { composeAdvanced };

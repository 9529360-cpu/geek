'use strict';

// Reuse the original subscription screen without its Electron script or global CSS.
function scopeStyles(source) {
  let depth = 0;
  let cursor = 0;
  let output = '';
  let keyframes = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      const selector = source.slice(cursor, index);
      if (depth === 0) {
        keyframes = selector.trim().startsWith('@keyframes');
        output += keyframes ? selector : selector.split(',').map((part) => {
          const value = part.trim();
          return [':root', 'body', 'html'].includes(value) ? '.session-dialog' : `.session-dialog ${value}`;
        }).join(',\n');
      } else output += selector;
      output += '{';
      depth += 1;
      cursor = index + 1;
    } else if (character === '}') {
      output += source.slice(cursor, index + 1);
      depth -= 1;
      cursor = index + 1;
    }
  }
  if (depth !== 0) throw new Error('Original subscription styles are unbalanced');
  return (output + source.slice(cursor)).replace(/\bfadeUp\b/g, 'sessionFadeUp').replace(/\bspin\b/g, 'sessionSpin');
}

function composeSession(original) {
  const style = original.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
  const body = original.match(/<body>\s*([\s\S]*?)\s*<script>/i)?.[1];
  if (!style || !body || !body.includes('id="view-login"')) throw new Error('Original subscription screen moved');
  const inline = [];
  const markup = body
    .replace(/\bid="([^"]+)"/g, 'id="session-$1"')
    .replace(/url\(#([^)]*)\)/g, 'url(#session-$1)')
    .replace(/<a\b/g, '<button type="button" class="session-text-link"').replace(/<\/a>/g, '</button>')
    .replace(/\sstyle="([^"]*)"/g, (_, declarations) => {
      if (/[{}<>]|url\s*\(|@/i.test(declarations)) throw new Error('Unreviewed subscription inline style');
      const name = `session-inline-${inline.length}`;
      inline.push(`.session-dialog .${name} { ${declarations}; }`);
      return ` class="${name}"`;
    });
  // Inline margin attributes occur on elements with existing classes. Keep both.
  const merged = markup.replace(/class="([^"]+)"([^<>]*?) class="(session-inline-\d+)"/g,
    (_, classes, attributes, extra) => `class="${classes} ${extra}"${attributes}`);
  if (/<script\b|\son[a-z]+\s*=|\sstyle\s*=/i.test(merged)) throw new Error('Unsafe subscription markup');
  return {
    html: '<div id="session-overlay" class="overlay hidden">\n'
      + '<section id="session-dialog" class="session-dialog" role="dialog" aria-modal="true" aria-label="极客账户">\n'
      + merged + '\n</section>\n</div>',
    css: scopeStyles(style.replace(/\.switch-row a\b/g, '.switch-row .session-text-link')) + '\n' + inline.join('\n'),
  };
}

module.exports = { composeSession };

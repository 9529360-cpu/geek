'use strict';
const fs = require('node:fs');
const path = require('node:path');

function commandNames() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/commands.json'), 'utf8'));
  const names = manifest.commands.map((command) => command.name);
  if (manifest.version !== 1 || !names.length || new Set(names).size !== names.length
      || names.some((name) => !/^[a-z]+(?:_[a-z]+)+$/.test(name))) {
    throw new Error('Invalid desktop command manifest');
  }
  return names;
}
if (require.main === module) process.stdout.write(commandNames().join('\n'));
module.exports = { commandNames };

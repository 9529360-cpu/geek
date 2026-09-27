'use strict';

const smoke = require('./telegram-send-intent-real-client-smoke.cjs');

async function main(argv = process.argv.slice(2), env = process.env) {
  let mode = 'preflight';
  try {
    mode = smoke.parseMode(argv);
    smoke.assertExecutionAllowed(mode, env, 'ordinary');
    const result = await smoke.runSmoke(mode, env, 'ordinary');
    process.stdout.write(JSON.stringify(smoke.projectEvidence(result)) + '\n');
    return result;
  } catch (error) {
    process.stderr.write(JSON.stringify(smoke.projectEvidence({
      scenario: 'ordinary',
      mode,
      code: error?.code || 'SMOKE_FAILED',
      sendResult: 'blocked',
    })) + '\n');
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) main();

module.exports = { main };
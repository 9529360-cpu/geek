'use strict';

const fs = require('node:fs/promises');

const TARGETS = Object.freeze({
  translation: Object.freeze({
    workflow: 'deploy-translate',
    endpoint: 'https://geek-translate.9529360.workers.dev/health'
  }),
  release: Object.freeze({
    workflow: 'deploy-release-worker',
    endpoint: 'https://geek-release.9529360.workers.dev/latest.yml'
  }),
  subscription: Object.freeze({
    workflow: 'deploy-subscription',
    endpoint: 'https://admin.bbnba.com/health'
  })
});

const ALLOWED_OUTCOMES = new Set([
  'success',
  'failure',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'stale',
  'startup_failure',
  'unknown'
]);

function resolveTarget(service) {
  const key = String(service || '').trim();
  const target = TARGETS[key];
  if (!target) throw new Error('Unsupported Cloudflare deployment service');
  return { service: key, ...target };
}

function normalizeOutcome(value, fallback = 'unknown') {
  const normalized = String(value || '').trim();
  return ALLOWED_OUTCOMES.has(normalized) ? normalized : fallback;
}

function requiredEnv(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validateRepository(value) {
  const repository = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Invalid GitHub repository identifier');
  }
  return repository;
}

function validateRunUrl(value) {
  const raw = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid GitHub Actions run URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(parsed.pathname)
  ) {
    throw new Error('Invalid GitHub Actions run URL');
  }
  return parsed.toString();
}

function shortCommit(value) {
  const sha = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 12) : 'unknown';
}

function safeTrigger(value) {
  const trigger = String(value || '').trim();
  return /^[a-z0-9_-]{1,32}$/i.test(trigger) ? trigger : 'unknown';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discardBody(response) {
  if (response?.body && typeof response.body.cancel === 'function') {
    await response.body.cancel().catch(() => {});
  }
}

async function verifyEndpoint(service, options = {}) {
  const target = resolveTarget(service);
  const fetchImpl = options.fetchImpl || global.fetch;
  const attempts = Number.isInteger(options.attempts) ? Math.max(1, options.attempts) : 3;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? Math.max(1, options.timeoutMs) : 20000;
  const retryDelayMs = Number.isInteger(options.retryDelayMs) ? Math.max(0, options.retryDelayMs) : 2000;
  const sleepImpl = options.sleepImpl || delay;

  if (typeof fetchImpl !== 'function') {
    return { outcome: 'failure', httpCode: 'unavailable', target };
  }

  let lastResult = { outcome: 'failure', httpCode: 'unavailable', target };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target.endpoint, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'geek-cloudflare-deploy-check/1' }
      });
      const status = Number(response?.status) || 0;
      await discardBody(response);
      lastResult = {
        outcome: status >= 200 && status < 400 ? 'success' : 'failure',
        httpCode: status ? String(status) : 'unavailable',
        target
      };
      if (lastResult.outcome === 'success') return lastResult;
    } catch {
      lastResult = { outcome: 'failure', httpCode: 'unavailable', target };
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts && retryDelayMs > 0) await sleepImpl(retryDelayMs);
  }
  return lastResult;
}

function buildReport({
  service,
  deployOutcome,
  verificationOutcome,
  httpCode,
  accountSmokeOutcome,
  runUrl,
  commitSha,
  triggerEvent
}) {
  const target = resolveTarget(service);
  const deploy = normalizeOutcome(deployOutcome, 'skipped');
  const verification = normalizeOutcome(verificationOutcome, 'skipped');
  const smokeRaw = String(accountSmokeOutcome || '').trim();
  const smoke = smokeRaw ? normalizeOutcome(smokeRaw) : '';
  const overall =
    deploy === 'success' &&
    verification === 'success' &&
    (!smoke || smoke === 'success')
      ? 'success'
      : 'failure';

  const lines = [
    `Run: ${runUrl}`,
    '',
    '### Cloudflare deployment',
    '',
    `- Service: \`${target.service}\``,
    `- Workflow: \`${target.workflow}\``,
    `- Trigger: \`${safeTrigger(triggerEvent)}\``,
    `- Wrangler deploy: \`${deploy}\``,
    `- Public verification: \`${verification}\` (\`HTTP ${String(httpCode || 'unavailable')}\`)`
  ];
  if (smoke) lines.push(`- Production account smoke: \`${smoke}\``);
  lines.push(
    `- Overall: **${overall}**`,
    `- Commit: \`${shortCommit(commitSha)}\``,
    `- Endpoint: \`${target.endpoint}\``,
    '',
    'No tokens, Authorization headers, cookies, DNS values, database contents, Cloudflare response bodies, or user data are included in this report.'
  );
  return { text: `${lines.join('\n')}\n`, overall };
}

async function postIssueComment({ repository, token, report, fetchImpl = global.fetch }) {
  if (typeof fetchImpl !== 'function') throw new Error('GitHub status publication is unavailable');
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/issues/21/comments`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'geek-cloudflare-deploy-report/1',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ body: report })
    }
  );
  const status = Number(response?.status) || 0;
  await discardBody(response);
  if (status < 200 || status >= 300) {
    throw new Error(`GitHub deployment status publication failed (${status || 'unknown'})`);
  }
}

async function main(env = process.env) {
  const service = requiredEnv(env, 'CLOUDFLARE_SERVICE');
  resolveTarget(service);
  const deployOutcome = normalizeOutcome(env.DEPLOY_OUTCOME, 'skipped');
  const verification = deployOutcome === 'success'
    ? await verifyEndpoint(service)
    : { outcome: 'skipped', httpCode: 'unavailable' };
  const runUrl = validateRunUrl(requiredEnv(env, 'RUN_URL'));
  const repository = validateRepository(requiredEnv(env, 'GITHUB_REPOSITORY'));
  const token = requiredEnv(env, 'GH_TOKEN');
  const summaryPath = requiredEnv(env, 'GITHUB_STEP_SUMMARY');

  const report = buildReport({
    service,
    deployOutcome,
    verificationOutcome: verification.outcome,
    httpCode: verification.httpCode,
    accountSmokeOutcome: env.ACCOUNT_SMOKE_OUTCOME,
    runUrl,
    commitSha: env.COMMIT_SHA,
    triggerEvent: env.TRIGGER_EVENT
  });

  await fs.appendFile(summaryPath, report.text, 'utf8');
  await postIssueComment({ repository, token, report: report.text });
  if (report.overall !== 'success') process.exitCode = 1;
}

module.exports = {
  TARGETS,
  resolveTarget,
  normalizeOutcome,
  verifyEndpoint,
  buildReport,
  postIssueComment,
  main
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[cloudflare-deploy-report] ${error.message}`);
    process.exitCode = 1;
  });
}

/**
 * Upstream checker module.
 * Periodically checks GitHub for new releases of upstream repositories
 * that containers are forked from.
 */
const cron = require('node-cron');
const log = require('../log').child({ component: 'upstream' });
const storeContainer = require('../store/container');
const event = require('../event');
const Github = require('./Github');
const { get } = require('../configuration');

const DEFAULT_CRON = '0 */12 * * *'; // Every 12 hours
const DELAY_BETWEEN_CHECKS_MS = 1500; // 1.5s between API calls to be gentle

let github;
let cronJob;

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise}
 */
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Parse "owner/repo" string.
 * @param {string} repoString
 * @returns {{owner: string, repo: string}|null}
 */
function parseRepo(repoString) {
    if (!repoString) return null;
    const parts = repoString.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        log.warn(`Invalid upstream repo format: "${repoString}" (expected "owner/repo")`);
        return null;
    }
    return { owner: parts[0], repo: parts[1] };
}

/**
 * Check upstream for a single container.
 * @param {object} container
 * @returns {Promise<object>} upstream report
 */
async function checkContainer(container) {
    const { upstream } = container;
    if (!upstream || !upstream.repo) return null;

    const parsed = parseRepo(upstream.repo);
    if (!parsed) return null;

    const logContainer = log.child({ container: container.name, upstream: upstream.repo });
    logContainer.debug('Checking upstream');

    try {
        const result = await github.getLatestVersion(
            parsed.owner,
            parsed.repo,
            upstream.prerelease || false,
        );

        const previousVersion = upstream.latestVersion;
        upstream.latestVersion = result.tag;
        upstream.latestUrl = result.url;
        upstream.checkedAt = new Date().toISOString();
        upstream.error = null;

        // Update container in store
        storeContainer.updateContainer(container);

        const changed = previousVersion !== result.tag;
        if (changed && previousVersion) {
            logContainer.info(
                `Upstream update: ${previousVersion} → ${result.tag}`,
            );
        } else {
            logContainer.debug(`Upstream latest: ${result.tag}`);
        }

        return { container, changed };
    } catch (e) {
        logContainer.warn(`Upstream check failed: ${e.message}`);
        upstream.error = e.message;
        upstream.checkedAt = new Date().toISOString();
        storeContainer.updateContainer(container);
        return { container, changed: false };
    }
}

/**
 * Check all containers with upstream tracking enabled.
 */
async function checkAll() {
    const containers = storeContainer.getContainers();
    const upstreamContainers = containers.filter(
        (c) => c.upstream && c.upstream.repo,
    );

    if (upstreamContainers.length === 0) {
        log.debug('No containers with upstream tracking configured');
        return;
    }

    log.info(
        `Checking upstream for ${upstreamContainers.length} container(s)`,
    );

    const reports = [];
    for (const container of upstreamContainers) {
        const report = await checkContainer(container);
        if (report) {
            reports.push(report);
            event.emitUpstreamReport(report);
        }
        // Delay between checks to avoid rate limiting
        if (upstreamContainers.indexOf(container) < upstreamContainers.length - 1) {
            await sleep(DELAY_BETWEEN_CHECKS_MS);
        }
    }

    if (reports.length > 0) {
        event.emitUpstreamReports(reports);
    }

    const updatesFound = reports.filter((r) => r.changed).length;
    if (updatesFound > 0) {
        log.info(`Found ${updatesFound} upstream update(s)`);
    } else {
        log.info('All upstreams are up to date');
    }
}

/**
 * Initialize the upstream checker.
 */
async function init() {
    // Read configuration from WUD_UPSTREAM_* env vars
    const config = get('wud.upstream', process.env);
    const githubToken = config.githubtoken || null;
    const cronExpression = config.cron || DEFAULT_CRON;

    if (githubToken) {
        log.info('GitHub token configured (authenticated mode — 5000 req/h)');
    } else {
        log.info(
            'No GitHub token configured (anonymous mode — 60 req/h). Set WUD_UPSTREAM_GITHUBTOKEN for higher limits.',
        );
    }

    github = new Github(githubToken);

    // Schedule periodic checks
    log.info(`Scheduling upstream checks with cron: ${cronExpression}`);
    cronJob = cron.schedule(cronExpression, async () => {
        try {
            await checkAll();
        } catch (e) {
            log.error(`Upstream check failed: ${e.message}`);
            log.debug(e);
        }
    });

    // Run initial check after a short delay (let watchers populate the store first)
    setTimeout(async () => {
        try {
            log.info('Running initial upstream check');
            await checkAll();
        } catch (e) {
            log.error(`Initial upstream check failed: ${e.message}`);
            log.debug(e);
        }
    }, 30000); // 30 second delay for watchers to finish
}

module.exports = {
    init,
    checkAll,
    checkContainer,
};

const logModule = require('../log');
const log = (logModule.default || logModule).child({ component: 'releasenotes' });
const storeContainer = require('../store/container');
const event = require('../event');
const Github = require('../upstream/Github');
const { get } = require('../configuration');

let github;

function parseRepo(repoString) {
    if (!repoString) return null;
    const parts = repoString.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return null;
    }
    return { owner: parts[0], repo: parts[1] };
}

async function resolveReleaseNotes(container) {
    if (!container.releaseRepo || !container.result || !container.result.tag) {
        return;
    }

    if (container.result.tag === container.image.tag.value) {
        return;
    }

    const parsed = parseRepo(container.releaseRepo);
    if (!parsed) return;

    const tag = container.result.tag;
    const logContainer = log.child({ container: container.name });

    try {
        let release = await github.getReleaseByTag(parsed.owner, parsed.repo, tag);
        if (release) {
            container.result.releaseNotes = release.body;
            container.result.releaseNotesExact = true;
            container.result.publishedAt = release.publishedAt;
            storeContainer.updateContainer(container);
            logContainer.debug(`Release notes found for tag ${tag}`);
            return;
        }

        const vToggled = tag.startsWith('v') ? tag.slice(1) : `v${tag}`;
        release = await github.getReleaseByTag(parsed.owner, parsed.repo, vToggled);
        if (release) {
            container.result.releaseNotes = release.body;
            container.result.releaseNotesExact = true;
            container.result.publishedAt = release.publishedAt;
            storeContainer.updateContainer(container);
            logContainer.debug(`Release notes found for tag ${vToggled} (v-prefix toggle)`);
            return;
        }

        container.result.releaseNotes = `https://github.com/${container.releaseRepo}/releases`;
        container.result.releaseNotesExact = false;
        storeContainer.updateContainer(container);
        logContainer.debug(`No exact release match — stored link fallback`);
    } catch (e) {
        logContainer.warn(`Failed to fetch release notes: ${e.message}`);
    }
}

async function onContainerReport(containerReport) {
    if (!github) return;
    const { container } = containerReport;
    if (!container || !container.updateAvailable || !container.releaseRepo) {
        return;
    }
    await resolveReleaseNotes(container);
}

async function init() {
    const config = get('wud.upstream', process.env);
    const githubToken = config.githubtoken || null;
    github = new Github(githubToken);

    event.registerContainerReport(onContainerReport);
    log.info('Release notes resolver initialized');
}

module.exports = {
    init,
    resolveReleaseNotes,
};

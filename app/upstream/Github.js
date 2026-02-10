const axios = require('axios');
const log = require('../log').child({ component: 'upstream.github' });

const GITHUB_API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT = 10000;

/**
 * GitHub API client for checking upstream releases and tags.
 */
class Github {
    constructor(token) {
        this.token = token;
        this.rateLimitRemaining = null;
    }

    /**
     * Build request headers.
     * @returns {object}
     */
    getHeaders() {
        const headers = {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'WUD-Upstream-Checker',
        };
        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }
        return headers;
    }

    /**
     * Track rate limit from response headers.
     * @param {object} headers
     */
    trackRateLimit(headers) {
        if (headers['x-ratelimit-remaining'] !== undefined) {
            this.rateLimitRemaining = parseInt(
                headers['x-ratelimit-remaining'],
                10,
            );
            if (this.rateLimitRemaining < 10) {
                log.warn(
                    `GitHub API rate limit low: ${this.rateLimitRemaining} requests remaining`,
                );
            }
        }
    }

    /**
     * Get the latest release for a repository.
     * @param {string} owner - Repository owner
     * @param {string} repo - Repository name
     * @param {boolean} includePrerelease - Whether to include pre-releases
     * @returns {Promise<{tag: string, url: string}|null>}
     */
    async getLatestRelease(owner, repo, includePrerelease = false) {
        try {
            if (includePrerelease) {
                // Fetch all releases and find the first one (latest)
                const response = await axios({
                    url: `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`,
                    method: 'get',
                    headers: this.getHeaders(),
                    timeout: REQUEST_TIMEOUT,
                    params: { per_page: 5 },
                });
                this.trackRateLimit(response.headers);
                const releases = response.data;
                if (releases && releases.length > 0) {
                    return {
                        tag: releases[0].tag_name,
                        url: releases[0].html_url,
                    };
                }
                return null;
            }

            // Standard: get only the latest non-prerelease
            const response = await axios({
                url: `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`,
                method: 'get',
                headers: this.getHeaders(),
                timeout: REQUEST_TIMEOUT,
            });
            this.trackRateLimit(response.headers);
            return {
                tag: response.data.tag_name,
                url: response.data.html_url,
            };
        } catch (error) {
            // 404 means no releases exist -- fall back to tags
            if (error.response && error.response.status === 404) {
                log.debug(
                    `No releases found for ${owner}/${repo}, falling back to tags`,
                );
                return null;
            }
            if (error.response && error.response.status === 403) {
                log.warn(
                    `GitHub API rate limited for ${owner}/${repo}. Consider setting WUD_UPSTREAM_GITHUBTOKEN.`,
                );
                throw new Error('GitHub API rate limited');
            }
            throw new Error(
                `Failed to fetch releases for ${owner}/${repo}: ${error.message}`,
            );
        }
    }

    /**
     * Get the latest tag for a repository (fallback when no releases exist).
     * @param {string} owner - Repository owner
     * @param {string} repo - Repository name
     * @returns {Promise<{tag: string, url: string}|null>}
     */
    async getLatestTag(owner, repo) {
        try {
            const response = await axios({
                url: `${GITHUB_API_BASE}/repos/${owner}/${repo}/tags`,
                method: 'get',
                headers: this.getHeaders(),
                timeout: REQUEST_TIMEOUT,
                params: { per_page: 1 },
            });
            this.trackRateLimit(response.headers);
            const tags = response.data;
            if (tags && tags.length > 0) {
                return {
                    tag: tags[0].name,
                    url: `https://github.com/${owner}/${repo}/releases/tag/${tags[0].name}`,
                };
            }
            return null;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                throw new Error(`Repository ${owner}/${repo} not found`);
            }
            if (error.response && error.response.status === 403) {
                throw new Error('GitHub API rate limited');
            }
            throw new Error(
                `Failed to fetch tags for ${owner}/${repo}: ${error.message}`,
            );
        }
    }

    /**
     * Get the latest version for a repository (tries releases first, then tags).
     * @param {string} owner - Repository owner
     * @param {string} repo - Repository name
     * @param {boolean} includePrerelease - Whether to include pre-releases
     * @returns {Promise<{tag: string, url: string}>}
     */
    async getLatestVersion(owner, repo, includePrerelease = false) {
        // Try releases first
        const release = await this.getLatestRelease(
            owner,
            repo,
            includePrerelease,
        );
        if (release) {
            return release;
        }

        // Fall back to tags
        const tag = await this.getLatestTag(owner, repo);
        if (tag) {
            return tag;
        }

        throw new Error(
            `No releases or tags found for ${owner}/${repo}`,
        );
    }
}

module.exports = Github;

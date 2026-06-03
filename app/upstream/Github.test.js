jest.mock('../log', () => ({
    child: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    }),
}));
jest.mock('axios');

const axios = require('axios');
const Github = require('./Github');

describe('Github', () => {
    let github;

    beforeEach(() => {
        jest.clearAllMocks();
        github = new Github('test-token');
    });

    describe('getLatestRelease', () => {
        test('should return body and publishedAt from latest release', async () => {
            axios.mockResolvedValue({
                data: {
                    tag_name: 'v1.0.0',
                    html_url: 'https://github.com/test/repo/releases/tag/v1.0.0',
                    body: '## Changes\n- Fix bug',
                    published_at: '2024-01-01T00:00:00Z',
                },
                headers: {},
            });

            const result = await github.getLatestRelease('test', 'repo');

            expect(result.tag).toBe('v1.0.0');
            expect(result.body).toBe('## Changes\n- Fix bug');
            expect(result.publishedAt).toBe('2024-01-01T00:00:00Z');
        });

        test('should return body from prerelease listing', async () => {
            axios.mockResolvedValue({
                data: [{
                    tag_name: 'v2.0.0-beta',
                    html_url: 'https://github.com/test/repo/releases/tag/v2.0.0-beta',
                    body: 'Beta release notes',
                    published_at: '2024-06-01T00:00:00Z',
                }],
                headers: {},
            });

            const result = await github.getLatestRelease('test', 'repo', true);

            expect(result.body).toBe('Beta release notes');
            expect(result.publishedAt).toBe('2024-06-01T00:00:00Z');
        });
    });

    describe('getReleaseByTag', () => {
        test('should return release for exact tag', async () => {
            axios.mockResolvedValue({
                data: {
                    tag_name: '2.35.1',
                    html_url: 'https://github.com/test/repo/releases/tag/2.35.1',
                    body: 'Release 2.35.1 notes',
                    published_at: '2024-03-15T00:00:00Z',
                },
                headers: {},
            });

            const result = await github.getReleaseByTag('test', 'repo', '2.35.1');

            expect(result).toEqual({
                tag: '2.35.1',
                url: 'https://github.com/test/repo/releases/tag/2.35.1',
                body: 'Release 2.35.1 notes',
                publishedAt: '2024-03-15T00:00:00Z',
            });
        });

        test('should return null on 404', async () => {
            axios.mockRejectedValue({
                response: { status: 404 },
            });

            const result = await github.getReleaseByTag('test', 'repo', 'nonexistent');

            expect(result).toBeNull();
        });

        test('should throw on rate limit', async () => {
            axios.mockRejectedValue({
                response: { status: 403 },
            });

            await expect(
                github.getReleaseByTag('test', 'repo', '1.0.0'),
            ).rejects.toThrow('GitHub API rate limited');
        });
    });
});

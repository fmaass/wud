jest.mock('../log', () => ({
    child: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        child: () => ({
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
        }),
    }),
}));
jest.mock('../store/container');
jest.mock('../event');
jest.mock('../upstream/Github');
jest.mock('../configuration');

const storeContainer = require('../store/container');
const event = require('../event');
const Github = require('../upstream/Github');
const { get } = require('../configuration');

const releasenotes = require('./index');

describe('Release Notes Module', () => {
    let mockGithubInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGithubInstance = {
            getReleaseByTag: jest.fn(),
        };
        Github.mockImplementation(() => mockGithubInstance);
        get.mockReturnValue({});
        storeContainer.updateContainer.mockImplementation((c) => c);
    });

    describe('init', () => {
        test('should initialize and register event handler', async () => {
            await releasenotes.init();
            expect(event.registerContainerReport).toHaveBeenCalledWith(
                expect.any(Function),
            );
        });
    });

    describe('resolveReleaseNotes', () => {
        beforeEach(async () => {
            await releasenotes.init();
        });

        test('should find exact tag match', async () => {
            mockGithubInstance.getReleaseByTag.mockResolvedValue({
                tag: '2.35.1',
                url: 'https://github.com/advplyr/audiobookshelf/releases/tag/2.35.1',
                body: '## What\'s Changed\n- Fix bug',
                publishedAt: '2024-01-01T00:00:00Z',
            });

            const container = {
                name: 'audiobookshelf',
                releaseRepo: 'advplyr/audiobookshelf',
                image: { tag: { value: '2.35.0' } },
                result: { tag: '2.35.1' },
            };

            await releasenotes.resolveReleaseNotes(container);

            expect(container.result.releaseNotes).toBe('## What\'s Changed\n- Fix bug');
            expect(container.result.releaseNotesExact).toBe(true);
            expect(container.result.publishedAt).toBe('2024-01-01T00:00:00Z');
            expect(storeContainer.updateContainer).toHaveBeenCalledWith(container);
        });

        test('should retry with v-prefix toggle', async () => {
            mockGithubInstance.getReleaseByTag
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    tag: 'v2.35.1',
                    url: 'https://github.com/test/repo/releases/tag/v2.35.1',
                    body: 'Release notes with v prefix',
                    publishedAt: '2024-01-01T00:00:00Z',
                });

            const container = {
                name: 'test',
                releaseRepo: 'test/repo',
                image: { tag: { value: '2.35.0' } },
                result: { tag: '2.35.1' },
            };

            await releasenotes.resolveReleaseNotes(container);

            expect(mockGithubInstance.getReleaseByTag).toHaveBeenCalledTimes(2);
            expect(mockGithubInstance.getReleaseByTag).toHaveBeenCalledWith('test', 'repo', '2.35.1');
            expect(mockGithubInstance.getReleaseByTag).toHaveBeenCalledWith('test', 'repo', 'v2.35.1');
            expect(container.result.releaseNotes).toBe('Release notes with v prefix');
            expect(container.result.releaseNotesExact).toBe(true);
        });

        test('should fall back to link on miss', async () => {
            mockGithubInstance.getReleaseByTag
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null);

            const container = {
                name: 'test',
                releaseRepo: 'test/repo',
                image: { tag: { value: '1.0.0' } },
                result: { tag: '2.0.0' },
            };

            await releasenotes.resolveReleaseNotes(container);

            expect(container.result.releaseNotes).toBe('https://github.com/test/repo/releases');
            expect(container.result.releaseNotesExact).toBe(false);
        });

        test('should not resolve when no update available', async () => {
            const container = {
                name: 'test',
                releaseRepo: 'test/repo',
                image: { tag: { value: '1.0.0' } },
                result: { tag: '1.0.0' },
            };

            await releasenotes.resolveReleaseNotes(container);

            expect(mockGithubInstance.getReleaseByTag).not.toHaveBeenCalled();
        });

        test('should not resolve when no releaseRepo', async () => {
            const container = {
                name: 'test',
                image: { tag: { value: '1.0.0' } },
                result: { tag: '2.0.0' },
            };

            await releasenotes.resolveReleaseNotes(container);

            expect(mockGithubInstance.getReleaseByTag).not.toHaveBeenCalled();
        });
    });
});

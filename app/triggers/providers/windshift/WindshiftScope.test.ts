import axios from 'axios';
import { Container, validate } from '../../../model/container';
import Windshift from './Windshift';

jest.mock('axios', () => jest.fn());

const axiosMock = axios as unknown as jest.Mock;

/**
 * Build a container through the real container model, so every case below is
 * classified by wud itself (`updateAvailable`, `updateKind`, `semverDiff`)
 * instead of being told what it is.
 */
function container({
    name = 'homeassistant',
    tag = '1.2.3',
    semver = true,
    resultTag,
    digest,
    resultDigest,
    created,
    resultCreated,
}: {
    name?: string;
    tag?: string;
    semver?: boolean;
    resultTag?: string;
    digest?: string;
    resultDigest?: string;
    created?: string;
    resultCreated?: string;
}): Container {
    return validate({
        id: 'abcdef0123456789',
        name,
        watcher: 'local',
        image: {
            id: 'sha256:1234',
            registry: { name: 'hub', url: 'https://registry-1.docker.io' },
            name: 'homeassistant/home-assistant',
            tag: { value: tag, semver },
            digest: { watch: digest !== undefined, value: digest },
            architecture: 'amd64',
            os: 'linux',
            created,
        },
        result: {
            tag: resultTag === undefined ? tag : resultTag,
            digest: resultDigest,
            created: resultCreated,
        },
    });
}

async function registeredTrigger() {
    const windshift = new Windshift();
    await windshift.register('trigger', 'windshift', 'test', {
        url: 'https://windshift.example',
        token: 'crw_secret-token',
        workspace: 3,
    });
    return windshift;
}

function postCalls() {
    return axiosMock.mock.calls
        .map((call) => call[0])
        .filter((options) => options && options.method === 'POST');
}

describe('Windshift Trigger scope (minor/major tag bumps only)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        axiosMock.mockImplementation(async (options: any) => {
            if (options.method === 'GET') {
                return {
                    status: 200,
                    data: {
                        data: [],
                        pagination: {
                            page: 1,
                            limit: 20,
                            total: 0,
                            total_pages: 0,
                            has_more: false,
                        },
                    },
                };
            }
            return { status: 201, data: { id: 4711 } };
        });
    });

    test('a major tag bump is filed', async () => {
        const windshift = await registeredTrigger();
        const target = container({ tag: '1.2.3', resultTag: '2.0.0' });

        expect(target.updateKind).toMatchObject({
            kind: 'tag',
            semverDiff: 'major',
        });
        expect(windshift.isInScope(target)).toBe(true);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(1);
    });

    test('a minor tag bump is filed', async () => {
        const windshift = await registeredTrigger();
        const target = container({ tag: '1.2.3', resultTag: '1.3.0' });

        expect(target.updateKind).toMatchObject({
            kind: 'tag',
            semverDiff: 'minor',
        });
        expect(windshift.isInScope(target)).toBe(true);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(1);
    });

    test('a patch tag bump is not filed', async () => {
        const windshift = await registeredTrigger();
        const target = container({ tag: '1.2.3', resultTag: '1.2.4' });

        expect(target.updateKind).toMatchObject({
            kind: 'tag',
            semverDiff: 'patch',
        });
        expect(windshift.isInScope(target)).toBe(false);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(0);
    });

    test('a prerelease tag bump is not filed', async () => {
        const windshift = await registeredTrigger();
        const target = container({
            tag: '1.2.3-rc.1',
            resultTag: '1.2.3-rc.2',
        });

        expect(target.updateKind).toMatchObject({
            kind: 'tag',
            semverDiff: 'prerelease',
        });
        expect(windshift.isInScope(target)).toBe(false);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(0);
    });

    test('a digest-only update is not filed', async () => {
        const windshift = await registeredTrigger();
        const target = container({
            digest: 'sha256:aaa',
            resultDigest: 'sha256:bbb',
        });

        expect(target.updateAvailable).toBe(true);
        expect(target.updateKind.kind).toEqual('digest');
        expect(windshift.isInScope(target)).toBe(false);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(0);
    });

    test('a non-semver tag update is not filed', async () => {
        const windshift = await registeredTrigger();
        const target = container({
            tag: 'latest',
            semver: false,
            resultTag: 'stable',
        });

        expect(target.updateKind).toMatchObject({
            kind: 'tag',
            semverDiff: 'unknown',
        });
        expect(windshift.isInScope(target)).toBe(false);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(0);
    });

    test('an update of unknown kind is not filed', async () => {
        const windshift = await registeredTrigger();
        // Same tag, no watched digest, a newer build date: wud reports an update
        // available whose kind it cannot name.
        const target = container({
            created: '2024-01-01T00:00:00.000Z',
            resultCreated: '2024-02-01T00:00:00.000Z',
        });

        expect(target.updateAvailable).toBe(true);
        expect(target.updateKind.kind).toEqual('unknown');
        expect(windshift.isInScope(target)).toBe(false);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(0);
    });

    // Documented behaviour, not an accident: wud folds semver `premajor` into
    // `major` (model/container.ts), so an RC of the next major IS filed. The
    // case asserts the intended non-exclusion so it cannot regress silently.
    test('a premajor RC, which wud classifies major, is filed', async () => {
        const windshift = await registeredTrigger();
        const target = container({ tag: '1.2.3', resultTag: '2.0.0-rc.1' });

        expect(target.updateKind.semverDiff).toEqual('major');
        expect(windshift.isInScope(target)).toBe(true);
        await windshift.trigger(target);
        expect(postCalls()).toHaveLength(1);
    });

    test('a batch files only the in-scope containers', async () => {
        const windshift = await registeredTrigger();
        const major = container({
            name: 'major-container',
            tag: '1.2.3',
            resultTag: '2.0.0',
        });
        const patch = container({
            name: 'patch-container',
            tag: '1.2.3',
            resultTag: '1.2.4',
        });
        const digest = container({
            name: 'digest-container',
            digest: 'sha256:aaa',
            resultDigest: 'sha256:bbb',
        });

        await windshift.triggerBatch([major, patch, digest]);

        expect(postCalls()).toHaveLength(1);
        expect(postCalls()[0].data.description).toContain(
            'wud:local:major-container:2.0.0',
        );
    });
});

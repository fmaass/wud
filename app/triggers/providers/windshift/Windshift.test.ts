import axios from 'axios';
import { Container } from '../../../model/container';
import Windshift, { buildMarker, markerFound } from './Windshift';

jest.mock('axios', () => jest.fn());

const axiosMock = axios as unknown as jest.Mock;

const TOKEN = 'crw_secret-token';

/**
 * A container with a minor tag bump (in scope for this trigger).
 */
function containerFixture(): Container {
    return {
        id: 'abcdef0123456789',
        name: 'homeassistant',
        watcher: 'local',
        image: {
            id: 'sha256:1234',
            registry: { name: 'hub', url: 'https://registry-1.docker.io' },
            name: 'homeassistant/home-assistant',
            tag: { value: '2021.6.4', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
        result: { tag: '2021.6.5' },
        updateAvailable: true,
        updateKind: {
            kind: 'tag',
            localValue: '2021.6.4',
            remoteValue: '2021.6.5',
            semverDiff: 'minor',
        },
    } as Container;
}

async function registeredTrigger(overrides: Record<string, unknown> = {}) {
    const windshift = new Windshift();
    await windshift.register('trigger', 'windshift', 'test', {
        url: 'https://windshift.example',
        token: TOKEN,
        workspace: 3,
        ...overrides,
    });
    return windshift;
}

/** The POST calls made through the mocked axios (the search GET is ignored). */
function postCalls() {
    return axiosMock.mock.calls
        .map((call) => call[0])
        .filter((options) => options && options.method === 'POST');
}

/** An empty search page, so every create path below reaches the POST. */
const EMPTY_SEARCH = {
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

/** Answer the dedup search with nothing and the create with `created`. */
function respondWith(created: any, failCreate?: Error) {
    axiosMock.mockImplementation(async (options: any) => {
        if (options.method === 'GET') {
            return EMPTY_SEARCH;
        }
        if (failCreate) {
            throw failCreate;
        }
        return created;
    });
}

describe('Windshift Trigger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        respondWith({ status: 201, data: { id: 4711 } });
    });

    test('should create instance', async () => {
        const windshift = new Windshift();
        expect(windshift).toBeInstanceOf(Windshift);
    });

    test('should require url, token and workspace', async () => {
        const windshift = new Windshift();
        expect(() =>
            windshift.validateConfiguration({
                token: TOKEN,
                workspace: 3,
            }),
        ).toThrow(/url/);
        expect(() =>
            windshift.validateConfiguration({
                url: 'https://windshift.example',
                workspace: 3,
            }),
        ).toThrow(/token/);
        expect(() =>
            windshift.validateConfiguration({
                url: 'https://windshift.example',
                token: TOKEN,
            }),
        ).toThrow(/workspace/);
    });

    test('should default itemtype to 4 and priority to 3', async () => {
        const windshift = new Windshift();
        const configuration = windshift.validateConfiguration({
            url: 'https://windshift.example',
            token: TOKEN,
            workspace: 3,
        });
        expect(configuration.itemtype).toBe(4);
        expect(configuration.priority).toBe(3);
    });

    test('should post the create-item request for a container', async () => {
        const windshift = await registeredTrigger();

        await windshift.trigger(containerFixture());

        expect(postCalls()).toHaveLength(1);
        expect(axiosMock).toHaveBeenCalledWith({
            method: 'POST',
            url: 'https://windshift.example/rest/api/v1/items',
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
            },
            data: {
                title: 'New tag found for container homeassistant',
                description:
                    'Container homeassistant running with tag 2021.6.4 can be updated to tag 2021.6.5\n\nwud:local:homeassistant:2021.6.5',
                workspace_id: 3,
                item_type_id: 4,
                priority_id: 3,
            },
        });
    });

    test('should honour configured itemtype and priority', async () => {
        const windshift = await registeredTrigger({ itemtype: 5, priority: 2 });

        await windshift.trigger(containerFixture());

        expect(postCalls()[0].data.item_type_id).toBe(5);
        expect(postCalls()[0].data.priority_id).toBe(2);
    });

    test('should strip a trailing slash from the configured url', async () => {
        const windshift = await registeredTrigger({
            url: 'https://windshift.example/',
        });

        await windshift.trigger(containerFixture());

        expect(postCalls()[0].url).toBe(
            'https://windshift.example/rest/api/v1/items',
        );
    });

    test('should append the dedup marker independently of the body template', async () => {
        const windshift = await registeredTrigger({
            simplebody: 'a body without any marker',
        });

        await windshift.trigger(containerFixture());

        expect(postCalls()[0].data.description).toBe(
            'a body without any marker\n\nwud:local:homeassistant:2021.6.5',
        );
    });

    test('should truncate the title to the 255 chars the api accepts', async () => {
        const windshift = await registeredTrigger({
            simpletitle: 'x'.repeat(400),
        });

        await windshift.trigger(containerFixture());

        expect(postCalls()[0].data.title).toHaveLength(255);
    });

    test('should give two names that normalise alike distinct markers (INFRA-125 review 3)', () => {
        const quoted = containerFixture();
        quoted.name = "a'b";
        const dashed = containerFixture();
        dashed.name = 'a-b';

        expect(buildMarker(quoted)).not.toEqual(buildMarker(dashed));
        expect(buildMarker(dashed)).toEqual('wud:local:a-b:2021.6.5');
        expect(buildMarker(quoted)).toMatch(
            /^wud:local:a-b-[0-9a-f]{8}:2021\.6\.5$/,
        );
    });

    test('should match a marker only as a bounded token (INFRA-125 review 3)', () => {
        expect(
            markerFound('body\n\nwud:local:app:2.1.1', 'wud:local:app:2.1.1'),
        ).toBe(true);
        expect(
            markerFound('body\n\nwud:local:app:2.1.10', 'wud:local:app:2.1.1'),
        ).toBe(false);
        expect(
            markerFound('x-wud:local:app:2.1.1', 'wud:local:app:2.1.1'),
        ).toBe(false);
        expect(
            markerFound('(wud:local:app:2.1.1)', 'wud:local:app:2.1.1'),
        ).toBe(true);
    });

    test('should mask the token in the configuration', async () => {
        const windshift = await registeredTrigger();

        const masked = windshift.maskConfiguration();

        expect(masked.token).toEqual('c**************n');
        expect(JSON.stringify(masked)).not.toContain(TOKEN);
        expect(masked.url).toEqual('https://windshift.example');
        expect(masked.workspace).toEqual(3);
    });

    test('should log at error and rethrow when the api answers 4xx', async () => {
        const windshift = await registeredTrigger();
        const logError = jest.spyOn(windshift.log, 'error');
        respondWith(
            undefined,
            new Error('Request failed with status code 401'),
        );

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            'Request failed with status code 401',
        );
        expect(logError).toHaveBeenCalled();
        expect(JSON.stringify(logError.mock.calls)).not.toContain(TOKEN);
    });

    test('should not log a response body carrying the token (INFRA-123 review 4)', async () => {
        const windshift = await registeredTrigger();
        const logError = jest.spyOn(windshift.log, 'error');
        respondWith({
            status: 200,
            data: {
                detail: 'unexpected',
                token: TOKEN,
                echo: `Authorization: Bearer ${TOKEN}`,
            },
        });

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            /id/,
        );
        const logged = JSON.stringify(logError.mock.calls);
        expect(logged).not.toContain(TOKEN);
        expect(logged).not.toContain('secret-token');
        // Positive control: the status is still reported.
        expect(logged).toContain('200');
    });

    test('should not log a transport error message carrying the token (INFRA-123 review 4)', async () => {
        const windshift = await registeredTrigger();
        const logError = jest.spyOn(windshift.log, 'error');
        respondWith(
            undefined,
            new Error(`connect ECONNREFUSED (token ${TOKEN})`),
        );

        await expect(windshift.trigger(containerFixture())).rejects.toThrow();
        const logged = JSON.stringify(logError.mock.calls);
        expect(logged).not.toContain(TOKEN);
        expect(logged).toContain('ECONNREFUSED');
    });

    test('should reject when the response carries no numeric id', async () => {
        const windshift = await registeredTrigger();
        respondWith({ status: 201, data: { key: 'INFRA-1' } });

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            /id/,
        );
    });

    test('should trigger a batch of containers', async () => {
        const windshift = await registeredTrigger();
        const other = containerFixture();
        other.name = 'grafana';
        other.updateKind.remoteValue = '11.2.0';

        await windshift.triggerBatch([containerFixture(), other]);

        expect(postCalls()).toHaveLength(2);
        expect(postCalls()[1].data.description).toContain(
            'wud:local:grafana:11.2.0',
        );
    });
});

/**
 * Everything a logger could read out of a logged argument: an Error's own
 * properties (an axios error carries `config.headers.Authorization`), its
 * cause chain and any nested object. `JSON.stringify` alone renders an Error
 * as `{}` and would hide exactly what this test is looking for.
 */
function serializeDeep(value: any, seen = new Set<any>()): string {
    if (value instanceof Error) {
        return `Error(${Object.getOwnPropertyNames(value)
            .map((key) => `${key}=${serializeDeep((value as any)[key], seen)}`)
            .join(',')})`;
    }
    if (value && typeof value === 'object') {
        if (seen.has(value)) {
            return '[circular]';
        }
        seen.add(value);
        return Object.entries(value)
            .map(([key, entry]) => `${key}=${serializeDeep(entry, seen)}`)
            .join(',');
    }
    return String(value);
}

function loggedText(logger: Record<string, jest.Mock>) {
    return ['warn', 'debug', 'info', 'error']
        .flatMap((level) => logger[level].mock.calls)
        .map((args) => args.map((arg: any) => serializeDeep(arg)).join(' '))
        .join('\n');
}

describe('Windshift Trigger errors at the base class boundary (INFRA-123 review)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function fakeLogger() {
        const logger: any = {
            warn: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
        };
        logger.child = jest.fn().mockReturnValue(logger);
        return logger;
    }

    function axiosLikeError() {
        const error: any = new Error(
            `Request failed with status code 401 (sent ${TOKEN})`,
        );
        error.config = {
            url: 'https://windshift.example/rest/api/v1/items',
            headers: { Authorization: `Bearer ${TOKEN}` },
        };
        error.request = { path: `/items?token=${TOKEN}` };
        error.response = {
            status: 401,
            data: { detail: 'invalid token', token: TOKEN },
        };
        return error;
    }

    test('a failed create reaches the base log without the token', async () => {
        const windshift = await registeredTrigger();
        const logger = fakeLogger();
        jest.spyOn(windshift.log, 'child').mockReturnValue(logger);
        respondWith(undefined, axiosLikeError());

        await windshift.handleContainerReport({
            container: containerFixture(),
            changed: true,
        });

        const logged = loggedText(logger);
        expect(logger.warn).toHaveBeenCalled();
        expect(logged).not.toContain(TOKEN);
        expect(logged).not.toContain('secret-token');
        // Positive control: the base log still says what happened.
        expect(logged).toContain('401');
    });

    test('a failed search reaches the base log without the token', async () => {
        const windshift = await registeredTrigger();
        const logger = fakeLogger();
        jest.spyOn(windshift.log, 'child').mockReturnValue(logger);
        axiosMock.mockImplementation(async () => {
            throw axiosLikeError();
        });

        await windshift.handleContainerReport({
            container: containerFixture(),
            changed: true,
        });

        const logged = loggedText(logger);
        expect(logged).not.toContain(TOKEN);
        expect(logged).toContain('401');
    });

    test('the batch path reports the same sanitized error', async () => {
        const windshift = await registeredTrigger();
        const logger = fakeLogger();
        windshift.log = logger;
        respondWith(undefined, axiosLikeError());

        await windshift.handleContainerReports([
            { container: containerFixture(), changed: true },
        ]);

        const logged = loggedText(logger);
        expect(logger.warn).toHaveBeenCalled();
        expect(logged).not.toContain(TOKEN);
        expect(logged).toContain('401');
    });

    test('the url-encoded form of the token is scrubbed too', async () => {
        const windshift = await registeredTrigger();
        const logError = jest.spyOn(windshift.log, 'error');
        const encoded = encodeURIComponent(TOKEN);
        respondWith(
            undefined,
            new Error(`connect reset while sending ?token=${encoded}`),
        );

        await expect(windshift.trigger(containerFixture())).rejects.toThrow();
        expect(JSON.stringify(logError.mock.calls)).not.toContain(encoded);
    });
});

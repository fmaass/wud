import axios from 'axios';
import { Container } from '../../../model/container';
import Windshift from './Windshift';

jest.mock('axios', () => jest.fn());

const axiosMock = axios as unknown as jest.Mock;

const MARKER = 'wud:local:homeassistant:2021.7.0';

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
        result: { tag: '2021.7.0' },
        updateAvailable: true,
        updateKind: {
            kind: 'tag',
            localValue: '2021.6.4',
            remoteValue: '2021.7.0',
            semverDiff: 'minor',
        },
    } as Container;
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

function callsOf(method: string) {
    return axiosMock.mock.calls
        .map((call) => call[0])
        .filter((options) => options && options.method === method);
}

/** Answer the search with these items and every create with a new item. */
function respondWith(items: unknown[]) {
    axiosMock.mockImplementation(async (options: any) => {
        if (options.method === 'GET') {
            return {
                status: 200,
                data: { data: items, pagination: { total: items.length } },
            };
        }
        return { status: 201, data: { id: 4711 } };
    });
}

/** Answer the search with one page per entry of `pages`. */
function respondWithPages(pages: any[][]) {
    axiosMock.mockImplementation(async (options: any) => {
        if (options.method === 'GET') {
            const page = options.params.page || 1;
            const items = pages[page - 1] || [];
            return {
                status: 200,
                data: {
                    data: items,
                    pagination: {
                        page,
                        limit: 20,
                        total: pages.flat().length,
                        total_pages: pages.length,
                        has_more: page < pages.length,
                    },
                },
            };
        }
        return { status: 201, data: { id: 4711 } };
    });
}

/** Answer every search page with `items` and has_more forever. */
function respondWithEndlessPages(items: any[]) {
    axiosMock.mockImplementation(async (options: any) => {
        if (options.method === 'GET') {
            return {
                status: 200,
                data: {
                    data: items,
                    pagination: {
                        page: options.params.page || 1,
                        limit: 20,
                        total: 1000,
                        total_pages: 50,
                        has_more: true,
                    },
                },
            };
        }
        return { status: 201, data: { id: 4711 } };
    });
}

function openItem(description: string, workspaceId = 3) {
    return {
        id: 42,
        key: 'INFRA-42',
        description,
        workspace_id: workspaceId,
        status: { id: 2, name: 'In Progress', category_name: 'In Progress' },
    };
}

describe('Windshift Trigger dedup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        respondWith([]);
    });

    test('searches the open items carrying the marker before creating', async () => {
        const windshift = await registeredTrigger();

        await windshift.trigger(containerFixture());

        expect(callsOf('GET')).toHaveLength(1);
        const search = callsOf('GET')[0];
        expect(search.url).toBe(
            'https://windshift.example/rest/api/v1/search/items',
        );
        expect(search.headers.Authorization).toBe('Bearer crw_secret-token');
        expect(search.params.ql).toContain(`description ~ '${MARKER}'`);
        expect(search.params.ql).toContain(
            "statusCategory NOT IN ('Done','Cancelled')",
        );
        expect(callsOf('POST')).toHaveLength(1);
    });

    test('does not create when an open item already carries the marker', async () => {
        const windshift = await registeredTrigger();
        const logInfo = jest.spyOn(windshift.log, 'info');
        respondWith([openItem(`some body\n\n${MARKER}`)]);

        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(0);
        expect(JSON.stringify(logInfo.mock.calls)).toContain('INFRA-42');
    });

    test('creates when the search comes back empty', async () => {
        const windshift = await registeredTrigger();
        respondWith([]);

        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(1);
    });

    test('creates when only terminal items carry the marker', async () => {
        const windshift = await registeredTrigger();
        respondWith([
            {
                id: 41,
                key: 'INFRA-41',
                description: `some body\n\n${MARKER}`,
                workspace_id: 3,
                status: {
                    id: 5,
                    name: 'Done',
                    category_name: 'Done',
                    is_completed: true,
                },
            },
        ]);

        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(1);
    });

    test('creates when the marker only matches an item of another workspace', async () => {
        const windshift = await registeredTrigger();
        respondWith([openItem(`some body\n\n${MARKER}`, 9)]);

        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(1);
    });

    test('creates when the hit does not actually carry the marker', async () => {
        const windshift = await registeredTrigger();
        respondWith([
            openItem('a body carrying wud:local:homeassistant:9.9.9'),
        ]);

        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(1);
    });

    test('two concurrent fires of the same update create exactly one item', async () => {
        const windshift = await registeredTrigger();
        let releaseSearch: () => void = () => undefined;
        axiosMock.mockImplementation((options: any) => {
            if (options.method === 'GET') {
                return new Promise((resolve) => {
                    releaseSearch = () =>
                        resolve({
                            status: 200,
                            data: { data: [], pagination: { total: 0 } },
                        });
                });
            }
            return Promise.resolve({ status: 201, data: { id: 4711 } });
        });

        const first = windshift.trigger(containerFixture());
        const second = windshift.trigger(containerFixture());
        await Promise.resolve();
        releaseSearch();
        await Promise.all([first, second]);

        expect(callsOf('GET')).toHaveLength(1);
        expect(callsOf('POST')).toHaveLength(1);
    });

    test('a settled flight releases its key, so a later fire can retry a failed create', async () => {
        const windshift = await registeredTrigger();
        axiosMock.mockImplementation(async (options: any) => {
            if (options.method === 'GET') {
                return {
                    status: 200,
                    data: { data: [], pagination: { total: 0 } },
                };
            }
            throw new Error('Request failed with status code 500');
        });

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            'Request failed with status code 500',
        );

        respondWith([]);
        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(2);
    });

    test('a failing search files nothing and reports the failure', async () => {
        const windshift = await registeredTrigger();
        const logError = jest.spyOn(windshift.log, 'error');
        axiosMock.mockImplementation(async (options: any) => {
            if (options.method === 'GET') {
                throw new Error('Request failed with status code 502');
            }
            return { status: 201, data: { id: 4711 } };
        });

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            'Request failed with status code 502',
        );
        expect(callsOf('POST')).toHaveLength(0);
        expect(logError).toHaveBeenCalled();
    });

    test('different updates of the same container are separate flights', async () => {
        const windshift = await registeredTrigger();
        const next = containerFixture();
        next.updateKind.remoteValue = '2021.8.0';

        await Promise.all([
            windshift.trigger(containerFixture()),
            windshift.trigger(next),
        ]);

        expect(callsOf('POST')).toHaveLength(2);
    });
});

describe('Windshift Trigger dedup — malformed search answers (INFRA-125 review 1)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each([
        ['a null body', null],
        ['an html body', '<html><body>Bad gateway</body></html>'],
        ['a data field that is not a list', { data: 'invalid' }],
        [
            'an item without a numeric id',
            { data: [{ id: 'x', workspace_id: 3 }] },
        ],
        [
            'an item without a numeric workspace_id',
            { data: [{ id: 1, workspace_id: '3' }] },
        ],
        [
            'an item whose status is not an object',
            { data: [{ id: 1, workspace_id: 3, status: 'In Progress' }] },
        ],
        [
            'a pagination envelope that is not an object',
            { data: [], pagination: 'nope' },
        ],
    ])('%s is a failed search, not an empty one', async (_label, data) => {
        const windshift = await registeredTrigger();
        const logError = jest.spyOn(windshift.log, 'error');
        axiosMock.mockImplementation(async (options: any) => {
            if (options.method === 'GET') {
                return { status: 200, data };
            }
            return { status: 201, data: { id: 4711 } };
        });

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            /search/i,
        );
        expect(callsOf('POST')).toHaveLength(0);
        expect(logError).toHaveBeenCalled();
    });
});

describe('Windshift Trigger dedup — paging (INFRA-125 review 2)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('a marker match on the second page stops the creation', async () => {
        const windshift = await registeredTrigger();
        const otherWorkspace = Array.from({ length: 20 }, (_unused, index) =>
            openItem(`some body\n\n${MARKER}`, 9 + index),
        );
        respondWithPages([
            otherWorkspace,
            [openItem(`some body\n\n${MARKER}`)],
        ]);

        await windshift.trigger(containerFixture());

        expect(callsOf('GET')).toHaveLength(2);
        expect(callsOf('GET')[1].params.page).toBe(2);
        expect(callsOf('POST')).toHaveLength(0);
    });

    test('the first page is asked for explicitly', async () => {
        const windshift = await registeredTrigger();
        respondWithPages([[]]);

        await windshift.trigger(containerFixture());

        expect(callsOf('GET')[0].params.page).toBe(1);
        expect(callsOf('POST')).toHaveLength(1);
    });

    test('a search still reporting more pages at the cap creates nothing', async () => {
        const windshift = await registeredTrigger();
        respondWithEndlessPages([openItem('a body with no marker at all')]);

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            /page/i,
        );
        expect(callsOf('GET')).toHaveLength(10);
        expect(callsOf('POST')).toHaveLength(0);
    });

    test('an empty page that still claims more is a failed search', async () => {
        const windshift = await registeredTrigger();
        respondWithEndlessPages([]);

        await expect(windshift.trigger(containerFixture())).rejects.toThrow(
            /search/i,
        );
        expect(callsOf('POST')).toHaveLength(0);
    });
});

describe('Windshift Trigger dedup — marker boundaries (INFRA-125 review 3)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('a longer tag sharing the prefix does not suppress the update', async () => {
        const windshift = await registeredTrigger();
        const container = containerFixture();
        container.updateKind.remoteValue = '2.1.1';
        respondWith([
            openItem(
                'an item of another update\n\nwud:local:homeassistant:2.1.10',
            ),
        ]);

        await windshift.trigger(container);

        expect(callsOf('POST')).toHaveLength(1);
    });

    test('the marker of that longer tag is still matched by its own item', async () => {
        const windshift = await registeredTrigger();
        const container = containerFixture();
        container.updateKind.remoteValue = '2.1.10';
        respondWith([
            openItem(
                'the item of this update\n\nwud:local:homeassistant:2.1.10',
            ),
        ]);

        await windshift.trigger(container);

        expect(callsOf('POST')).toHaveLength(0);
    });

    test('a marker glued to a longer prefix does not count as a match', async () => {
        const windshift = await registeredTrigger();
        respondWith([openItem(`prefixed-${MARKER}`)]);

        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(1);
    });

    test('a marker ending the description is matched', async () => {
        const windshift = await registeredTrigger();
        respondWith([openItem(`a body\n\n${MARKER}`)]);

        await windshift.trigger(containerFixture());

        expect(callsOf('POST')).toHaveLength(0);
    });
});

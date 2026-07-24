// @ts-nocheck
// Mock all dependencies
jest.mock('./configuration', () => ({
    getVersion: jest.fn(() => '1.0.0'),
}));

jest.mock('./log', () => {
    const mock = {
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
    };
    mock.child = jest.fn(() => mock);
    return mock;
});

jest.mock('./store', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./registry', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./upstream', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./releasenotes', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./api', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./prometheus', () => ({
    init: jest.fn(),
}));

describe('Main Application', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        jest.resetModules();
    });

    test('should initialize all components in correct order', async () => {
        const { default: log } = await import('./log');
        const store = await import('./store');
        const registry = await import('./registry');
        const upstream = await import('./upstream');
        const releasenotes = await import('./releasenotes');
        const api = await import('./api');
        const prometheus = await import('./prometheus');
        const { getVersion } = await import('./configuration');

        // Import and run the main module
        await import('./index');

        await new Promise((resolve) => setImmediate(resolve));

        expect(getVersion).toHaveBeenCalled();
        expect(log.info).toHaveBeenCalledWith(
            'WUD is starting (version = 1.0.0)',
        );
        expect(store.init).toHaveBeenCalled();
        expect(prometheus.init).toHaveBeenCalled();
        expect(registry.init).toHaveBeenCalled();
        expect(upstream.init).toHaveBeenCalled();
        expect(releasenotes.init).toHaveBeenCalled();
        expect(api.init).toHaveBeenCalled();
    });
});

const { getVersion } = require('./configuration');
const log = require('./log');
const store = require('./store');
const registry = require('./registry');
const upstream = require('./upstream');
const api = require('./api');
const prometheus = require('./prometheus');

async function main() {
    log.info(`WUD is starting (version = ${getVersion()})`);

    // Init store
    await store.init();

    // Start Prometheus registry
    prometheus.init();

    // Init registry (triggers, registries, watchers, authentications)
    await registry.init();

    // Init upstream checker (checks GitHub for upstream repo updates)
    await upstream.init();

    // Init api
    await api.init();
}
main();

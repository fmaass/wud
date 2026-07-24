// @ts-nocheck
import { getVersion } from './configuration';
import log from './log';
import * as store from './store';
import * as registry from './registry';
import * as upstream from './upstream';
import * as releasenotes from './releasenotes';
import * as api from './api';
import * as prometheus from './prometheus';

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

    // Init release notes resolver (fetches release notes for vanilla containers)
    await releasenotes.init();

    // Init api
    await api.init();
}
main();

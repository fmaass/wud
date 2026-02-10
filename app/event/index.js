const events = require('events');

// Build EventEmitter
const eventEmitter = new events.EventEmitter();

// Container related events
const WUD_CONTAINER_ADDED = 'wud:container-added';
const WUD_CONTAINER_UPDATED = 'wud:container-updated';
const WUD_CONTAINER_REMOVED = 'wud:container-removed';
const WUD_CONTAINER_REPORT = 'wud:container-report';
const WUD_CONTAINER_REPORTS = 'wud:container-reports';

// Upstream related events
const WUD_UPSTREAM_REPORT = 'wud:upstream-report';
const WUD_UPSTREAM_REPORTS = 'wud:upstream-reports';

// Watcher related events
const WUD_WATCHER_START = 'wud:watcher-start';
const WUD_WATCHER_STOP = 'wud:watcher-stop';

/**
 * Emit ContainerReports event.
 * @param containerReports
 */
function emitContainerReports(containerReports) {
    eventEmitter.emit(WUD_CONTAINER_REPORTS, containerReports);
}

/**
 * Register to ContainersResult event.
 * @param handler
 */
function registerContainerReports(handler) {
    eventEmitter.on(WUD_CONTAINER_REPORTS, handler);
}

/**
 * Emit ContainerReport event.
 * @param containerReport
 */
function emitContainerReport(containerReport) {
    eventEmitter.emit(WUD_CONTAINER_REPORT, containerReport);
}

/**
 * Register to ContainerReport event.
 * @param handler
 */
function registerContainerReport(handler) {
    eventEmitter.on(WUD_CONTAINER_REPORT, handler);
}

/**
 * Emit container added.
 * @param containerAdded
 */
function emitContainerAdded(containerAdded) {
    eventEmitter.emit(WUD_CONTAINER_ADDED, containerAdded);
}

/**
 * Register to container added event.
 * @param handler
 */
function registerContainerAdded(handler) {
    eventEmitter.on(WUD_CONTAINER_ADDED, handler);
}

/**
 * Emit container added.
 * @param containerUpdated
 */
function emitContainerUpdated(containerUpdated) {
    eventEmitter.emit(WUD_CONTAINER_UPDATED, containerUpdated);
}

/**
 * Register to container updated event.
 * @param handler
 */
function registerContainerUpdated(handler) {
    eventEmitter.on(WUD_CONTAINER_UPDATED, handler);
}

/**
 * Emit container removed.
 * @param containerRemoved
 */
function emitContainerRemoved(containerRemoved) {
    eventEmitter.emit(WUD_CONTAINER_REMOVED, containerRemoved);
}

/**
 * Register to container removed event.
 * @param handler
 */
function registerContainerRemoved(handler) {
    eventEmitter.on(WUD_CONTAINER_REMOVED, handler);
}

/**
 * Emit UpstreamReport event.
 * @param upstreamReport
 */
function emitUpstreamReport(upstreamReport) {
    eventEmitter.emit(WUD_UPSTREAM_REPORT, upstreamReport);
}

/**
 * Register to UpstreamReport event.
 * @param handler
 */
function registerUpstreamReport(handler) {
    eventEmitter.on(WUD_UPSTREAM_REPORT, handler);
}

/**
 * Emit UpstreamReports event.
 * @param upstreamReports
 */
function emitUpstreamReports(upstreamReports) {
    eventEmitter.emit(WUD_UPSTREAM_REPORTS, upstreamReports);
}

/**
 * Register to UpstreamReports event.
 * @param handler
 */
function registerUpstreamReports(handler) {
    eventEmitter.on(WUD_UPSTREAM_REPORTS, handler);
}

function emitWatcherStart(watcher) {
    eventEmitter.emit(WUD_WATCHER_START, watcher);
}

function registerWatcherStart(handler) {
    eventEmitter.on(WUD_WATCHER_START, handler);
}

function emitWatcherStop(watcher) {
    eventEmitter.emit(WUD_WATCHER_STOP, watcher);
}

function registerWatcherStop(handler) {
    eventEmitter.on(WUD_WATCHER_STOP, handler);
}
module.exports = {
    emitContainerReports,
    registerContainerReports,
    emitContainerReport,
    registerContainerReport,
    emitContainerAdded,
    registerContainerAdded,
    emitContainerUpdated,
    registerContainerUpdated,
    emitContainerRemoved,
    registerContainerRemoved,
    emitUpstreamReport,
    registerUpstreamReport,
    emitUpstreamReports,
    registerUpstreamReports,
    emitWatcherStart,
    registerWatcherStart,
    emitWatcherStop,
    registerWatcherStop,
};

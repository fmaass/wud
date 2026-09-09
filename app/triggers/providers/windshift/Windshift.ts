import { createHash } from 'node:crypto';
import axios from 'axios';
import { Container } from '../../../model/container';
import Trigger, { TriggerConfiguration } from '../Trigger';

/** Base path of the windshift REST api (see windshift-openapi.json). */
const API_PATH = '/rest/api/v1';

/** `title` is capped by the windshift item contract. */
const TITLE_MAX_LENGTH = 255;

/**
 * The clause that keeps the dedup search to items still open. Terminality is a
 * status CATEGORY question and it is asked of the SERVER: the item payload
 * carries no usable category (it reports `category_id: 0` and omits
 * `is_completed`), so it cannot be decided from the search results alone. The
 * clause excludes rather than includes, so a renamed or added category leaves
 * one stray item to look at instead of silently draining the search to nothing.
 */
const OPEN_CATEGORY_CQL = "statusCategory NOT IN ('Done','Cancelled')";

/** Status categories treated as terminal by the client-side regression net. */
const TERMINAL_CATEGORY_NAMES = ['done', 'cancelled'];

/** Items asked for per search page. */
const SEARCH_PAGE_LIMIT = 20;

/**
 * How many search pages are read before the search is called failed. A marker
 * identifies one update, so a match sits on the first page in practice; the cap
 * only stops a server that keeps reporting more, and reaching it is a FAILED
 * search (no item is created) rather than "no match".
 */
const SEARCH_MAX_PAGES = 10;

/** How much of a response body may reach the log. */
const LOG_BODY_MAX_LENGTH = 200;

/** Field names whose value is a credential and never logged. */
const SECRET_FIELD = /(token|authorization|secret|password|bearer)/i;

/**
 * The semver differences worth a work item. wud folds `premajor`/`preminor`
 * into these (model/container.ts), so an RC of the next major or minor is in
 * scope too, while patch, prerelease, digest-only and non-semver updates are
 * deliberately left out.
 */
const IN_SCOPE_SEMVER_DIFFS = ['major', 'minor'];

/**
 * Characters kept in a marker. The marker is written into the item description
 * and read back through a search query, so it is restricted to a set that
 * cannot carry a quote into that query and cannot be reformatted on the way.
 */
const MARKER_UNSAFE = /[^A-Za-z0-9._/@+-]/g;

/** One character of a marker; anything else bounds it. */
const MARKER_CHAR = /[A-Za-z0-9._/@+-]/;

/**
 * Normalize one marker segment.
 * @param value the raw value
 * @returns {string} the segment, safe to embed in a marker
 */
function markerSegment(value: string | undefined) {
    const raw = value || 'unknown';
    const normalized = raw.replace(MARKER_UNSAFE, '-');
    if (normalized === raw) {
        return normalized;
    }
    // Normalisation is lossy (`a'b` and `a-b` both normalise to `a-b`), so a
    // segment it had to change carries a digest of the original: two different
    // containers cannot end up sharing one marker.
    return `${normalized}-${createHash('sha256').update(raw).digest('hex').substring(0, 8)}`;
}

/**
 * Return true when the description carries the marker as a bounded token.
 * A plain substring test would let `wud:local:app:2.1.10` answer for
 * `wud:local:app:2.1.1` and silence that update for good.
 * @param description the item description
 * @param marker the dedup marker of the update
 * @returns {boolean}
 */
export function markerFound(description: string, marker: string) {
    let index = description.indexOf(marker);
    while (index !== -1) {
        const before = index === 0 ? undefined : description[index - 1];
        const after = description[index + marker.length];
        if (
            (before === undefined || !MARKER_CHAR.test(before)) &&
            (after === undefined || !MARKER_CHAR.test(after))
        ) {
            return true;
        }
        index = description.indexOf(marker, index + 1);
    }
    return false;
}

/**
 * Replace the value of every credential-looking field.
 * @param value the value to walk
 * @param depth the current depth
 * @returns {*} the value, with credential fields replaced
 */
function redactSecretFields(value: any, depth = 0): any {
    if (depth > 4 || value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => redactSecretFields(entry, depth + 1));
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
            key,
            SECRET_FIELD.test(key)
                ? '***'
                : redactSecretFields(entry, depth + 1),
        ]),
    );
}

/**
 * Build the dedup marker of a container update.
 * It identifies the update itself (watcher, container, target tag) and is
 * appended to the item description, so a rendered body template cannot change
 * it and a later run can find the item it belongs to.
 * @param container the container
 * @returns {string} the marker
 */
export function buildMarker(container: Container) {
    const targetTag =
        (container.updateKind && container.updateKind.remoteValue) ||
        (container.result && container.result.tag);
    return [
        'wud',
        markerSegment(container.watcher),
        markerSegment(container.name),
        markerSegment(targetTag),
    ].join(':');
}

/**
 * Return why an item of a search answer is malformed, or undefined when it has
 * the shape this trigger reads.
 * @param item one item of the search answer
 * @returns {string | undefined}
 */
function itemShapeProblem(item: any) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return 'an item is not an object';
    }
    if (typeof item.id !== 'number') {
        return 'an item carries no numeric id';
    }
    if (typeof item.workspace_id !== 'number') {
        return 'an item carries no numeric workspace_id';
    }
    if (
        item.description !== undefined &&
        typeof item.description !== 'string'
    ) {
        return 'an item carries a description that is not a string';
    }
    const { status } = item;
    if (status !== undefined) {
        if (
            status === null ||
            typeof status !== 'object' ||
            Array.isArray(status)
        ) {
            return 'an item carries a status that is not an object';
        }
        if (
            status.is_completed !== undefined &&
            typeof status.is_completed !== 'boolean'
        ) {
            return 'an item carries a non-boolean status.is_completed';
        }
        if (
            status.category_name !== undefined &&
            typeof status.category_name !== 'string'
        ) {
            return 'an item carries a non-string status.category_name';
        }
    }
    return undefined;
}

export interface WindshiftConfiguration extends TriggerConfiguration {
    url: string;
    token: string;
    workspace: number;
    itemtype: number;
    priority: number;
}

/**
 * Windshift Trigger implementation.
 * Files a windshift work item when a watched container has a new version.
 */
class Windshift extends Trigger {
    public configuration: WindshiftConfiguration = {} as WindshiftConfiguration;

    /**
     * The creations in flight, by marker. The scan and a manual trigger can ask
     * for the same item at the same moment; the search alone cannot stop that,
     * because neither creation is committed while the other one searches.
     */
    private readonly flights = new Map<string, Promise<number | undefined>>();

    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            url: this.joi
                .string()
                .uri({ scheme: ['http', 'https'] })
                .required(),
            token: this.joi.string().required(),
            workspace: this.joi.number().integer().min(1).required(),
            itemtype: this.joi.number().integer().min(1).default(4),
            priority: this.joi.number().integer().min(1).default(3),
        });
    }

    /**
     * Sanitize sensitive data.
     * @returns {*}
     */
    maskConfiguration() {
        return {
            ...this.configuration,
            token: Windshift.mask(this.configuration.token),
        };
    }

    /**
     * File a windshift item for the container.
     * @param container the container
     * @returns {Promise<void>}
     */
    async trigger(container: Container) {
        await this.createTicket(container);
    }

    /**
     * File a windshift item per container.
     * @param containers the containers
     * @returns {Promise<void>}
     */
    async triggerBatch(containers: Container[]) {
        const failures: Error[] = [];
        const inScope = containers.filter((container) =>
            this.isInScope(container),
        );
        for (const container of inScope) {
            try {
                await this.createTicket(container);
            } catch (e: any) {
                // Keep filing the remaining containers; the batch reports at the end.
                failures.push(e);
            }
        }
        if (failures.length > 0) {
            throw new Error(
                `Failed to create ${failures.length} windshift item(s) (${failures
                    .map((failure) => failure.message)
                    .join(', ')})`,
            );
        }
    }

    /**
     * Return true when the update deserves a work item: a minor or major
     * semver tag bump, as wud itself classified it.
     * @param container the container
     * @returns {boolean}
     */
    isInScope(container: Container) {
        const updateKind = container.updateKind;
        return (
            updateKind !== undefined &&
            updateKind.kind === 'tag' &&
            updateKind.semverDiff !== undefined &&
            IN_SCOPE_SEMVER_DIFFS.includes(updateKind.semverDiff)
        );
    }

    /**
     * Create the windshift item of a container update.
     * @param container the container
     * @returns {Promise<number | undefined>} the id of the created item
     */
    async createTicket(container: Container) {
        if (!this.isInScope(container)) {
            this.log.debug(
                `Update of ${container.name} is not a minor/major tag bump => ignore`,
            );
            return undefined;
        }
        const marker = buildMarker(container);
        const running = this.flights.get(marker);
        if (running) {
            this.log.debug(
                `Creation of ${marker} is already in flight => join`,
            );
            return running;
        }
        const flight = this.createTicketOnce(container, marker);
        this.flights.set(marker, flight);
        try {
            return await flight;
        } finally {
            // Released whatever the outcome: a failed creation must be retried
            // by the next run (which is what `once=false` is for).
            this.flights.delete(marker);
        }
    }

    /**
     * Create the item unless windshift already tracks this update.
     * @param container the container
     * @param marker the dedup marker of the update
     * @returns {Promise<number | undefined>} the id of the created item
     */
    private async createTicketOnce(container: Container, marker: string) {
        const existing = await this.findOpenItem(marker);
        if (existing) {
            this.log.info(
                `Update ${marker} is already tracked by ${existing.key || existing.id} => skip`,
            );
            return undefined;
        }
        return this.postItem(container, marker);
    }

    /**
     * Find an open windshift item carrying the marker.
     * Every page of the answer is read: a match sitting behind a page of items
     * belonging to other workspaces would otherwise be missed and the update
     * filed twice.
     * @param marker the dedup marker of the update
     * @returns {Promise<any | undefined>} the item, if there is one
     */
    private async findOpenItem(marker: string) {
        for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
            const { items, hasMore } = await this.searchPage(marker, page);
            const match = items.find((item: any) =>
                this.isOpenItemOf(item, marker),
            );
            if (match) {
                return match;
            }
            if (!hasMore) {
                return undefined;
            }
            if (items.length === 0) {
                throw this.failedSearch(
                    marker,
                    `page ${page} came back empty while the same answer reports more`,
                );
            }
        }
        throw this.failedSearch(
            marker,
            `more results were still reported after ${SEARCH_MAX_PAGES} pages`,
        );
    }

    /**
     * Read one page of the dedup search.
     * @param marker the dedup marker of the update
     * @param page the 1-based page number
     * @returns {Promise<{items: any[], hasMore: boolean}>}
     */
    private async searchPage(marker: string, page: number) {
        let response;
        try {
            response = await axios({
                method: 'GET',
                url: `${this.getApiUrl()}/search/items`,
                headers: {
                    Authorization: `Bearer ${this.configuration.token}`,
                },
                params: {
                    ql: `description ~ '${marker}' AND ${OPEN_CATEGORY_CQL}`,
                    page,
                    limit: SEARCH_PAGE_LIMIT,
                },
            });
        } catch (e: any) {
            // Creating on a failed search would file a duplicate of an item
            // that may well exist, so the run fails and the next one retries.
            throw this.failedSearch(marker, this.describeError(e));
        }
        return this.parseSearchPage(marker, response);
    }

    /**
     * Read the item list out of a search answer, refusing anything that is not
     * one: a 2xx carrying a proxy error page or a truncated body must not be
     * read as "no item exists", which is the answer that files a duplicate.
     * @param marker the dedup marker of the update
     * @param response the axios response
     * @returns {{items: any[], hasMore: boolean}}
     */
    private parseSearchPage(marker: string, response: any) {
        const data = response ? response.data : undefined;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw this.failedSearch(
                marker,
                `the search answer is not an object (${this.describeResponse(response)})`,
            );
        }
        if (!Array.isArray(data.data)) {
            throw this.failedSearch(
                marker,
                `the search answer carries no item list (${this.describeResponse(response)})`,
            );
        }
        data.data.forEach((item: any) => {
            const problem = itemShapeProblem(item);
            if (problem) {
                throw this.failedSearch(
                    marker,
                    `the search answer carries a malformed item (${problem})`,
                );
            }
        });
        const { pagination } = data;
        if (
            pagination !== undefined &&
            (pagination === null ||
                typeof pagination !== 'object' ||
                Array.isArray(pagination))
        ) {
            throw this.failedSearch(
                marker,
                'the search answer carries a malformed pagination envelope',
            );
        }
        if (
            pagination &&
            pagination.has_more !== undefined &&
            typeof pagination.has_more !== 'boolean'
        ) {
            throw this.failedSearch(
                marker,
                'the search answer reports a non-boolean has_more',
            );
        }
        return {
            items: data.data as any[],
            hasMore: pagination ? pagination.has_more === true : false,
        };
    }

    /**
     * Log a failed search and build the error that ends the run with it.
     * @param marker the dedup marker of the update
     * @param reason why the search is considered failed
     * @returns {Error}
     */
    private failedSearch(marker: string, reason: string) {
        this.log.error(`Failed to search windshift for ${marker} (${reason})`);
        return new Error(`windshift search of ${marker} failed (${reason})`);
    }

    /**
     * Describe a response for the log: its status and a bounded, scrubbed
     * snippet of its body. The body is written by whatever answered the
     * request, so it may echo the request — the token included.
     * @param response the axios response
     * @returns {string}
     */
    private describeResponse(response: any) {
        const status =
            response && response.status !== undefined
                ? response.status
                : 'unknown';
        const data = response ? response.data : undefined;
        let body;
        if (data === undefined) {
            body = 'none';
        } else if (typeof data === 'string') {
            body = data;
        } else {
            try {
                body = JSON.stringify(redactSecretFields(data));
            } catch {
                body = String(data);
            }
        }
        return `status ${status}, body ${this.scrub(body)}`;
    }

    /**
     * Remove the configured token from a text and bound its length.
     * @param text the text to scrub
     * @returns {string}
     */
    private scrub(text: string) {
        const token = this.configuration.token;
        let scrubbed = String(text);
        if (token) {
            // The plain value and the form a url-encoded request target carries.
            [token, encodeURIComponent(token)].forEach((secret) => {
                scrubbed = scrubbed.split(secret).join('***');
            });
        }
        return scrubbed.substring(0, LOG_BODY_MAX_LENGTH);
    }

    /**
     * Describe a failure for the log and for the error that leaves this
     * provider: its scrubbed message plus, when the transport carries one, the
     * status and a scrubbed body snippet.
     *
     * The ORIGINAL error is never rethrown and never becomes a `cause`: the
     * base trigger logs the error object it catches, and an axios error carries
     * `config.headers.Authorization` — the token would reach the log above this
     * provider's own scrubbed line.
     * @param e the caught error
     * @returns {string}
     */
    private describeError(e: any) {
        const message = this.scrub(e && e.message ? e.message : String(e));
        const response = e ? e.response : undefined;
        return response
            ? `${message} (${this.describeResponse(response)})`
            : message;
    }

    /**
     * Return true when the item is an open item of this trigger's workspace
     * carrying the marker.
     * @param item the item answered by the search
     * @param marker the dedup marker of the update
     * @returns {boolean}
     */
    private isOpenItemOf(item: any, marker: string) {
        if (!item || typeof item.description !== 'string') {
            return false;
        }
        if (!markerFound(item.description, marker)) {
            return false;
        }
        // The workspace is matched here rather than in the query: the search
        // language names a workspace by key, and a numeric id in it is answered
        // with an empty result instead of an error.
        if (
            typeof item.workspace_id === 'number' &&
            item.workspace_id !== this.configuration.workspace
        ) {
            return false;
        }
        // Regression net for the query above; the server stays the authority.
        const status = item.status || {};
        const categoryName = String(status.category_name || '').toLowerCase();
        return (
            status.is_completed !== true &&
            !TERMINAL_CATEGORY_NAMES.includes(categoryName)
        );
    }

    /**
     * POST the create-item request.
     * @param container the container
     * @param marker the dedup marker to append to the description
     * @returns {Promise<number>} the id of the created item
     */
    private async postItem(container: Container, marker: string) {
        const body = {
            title: this.renderSimpleTitle(container).substring(
                0,
                TITLE_MAX_LENGTH,
            ),
            description: `${this.renderSimpleBody(container)}\n\n${marker}`,
            workspace_id: this.configuration.workspace,
            item_type_id: this.configuration.itemtype,
            priority_id: this.configuration.priority,
        };
        let response;
        try {
            response = await axios({
                method: 'POST',
                url: `${this.getApiUrl()}/items`,
                headers: {
                    Authorization: `Bearer ${this.configuration.token}`,
                    'Content-Type': 'application/json',
                },
                data: body,
            });
        } catch (e: any) {
            // The base trigger swallows errors and logs what it caught, so the
            // reason is logged here and a NEW error carries only scrubbed text.
            const reason = this.describeError(e);
            this.log.error(
                `Failed to create the windshift item of ${marker} (${reason})`,
            );
            throw new Error(
                `windshift refused the item of ${marker} (${reason})`,
            );
        }
        const id = response.data ? response.data.id : undefined;
        if (typeof id !== 'number') {
            this.log.error(
                `The windshift item of ${marker} was answered without an id (${this.describeResponse(response)})`,
            );
            throw new Error(
                `windshift did not answer the created item with a numeric id (${marker}, ${this.describeResponse(response)})`,
            );
        }
        this.log.info(`Created windshift item ${id} for ${marker}`);
        return id;
    }

    /**
     * Get the windshift api base url (without trailing slash).
     * @returns {string}
     */
    private getApiUrl() {
        return `${this.configuration.url.replace(/\/+$/, '')}${API_PATH}`;
    }
}

export default Windshift;

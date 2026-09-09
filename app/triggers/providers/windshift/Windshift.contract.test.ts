import joi from 'joi';
import axios from 'axios';
import { Container } from '../../../model/container';
import Windshift from './Windshift';
import spec from './windshift-openapi.json';

jest.mock('axios', () => jest.fn());

const axiosMock = axios as unknown as jest.Mock;

/**
 * Translate the (small) subset of OpenAPI/JSON-Schema the vendored windshift
 * contract uses into a joi schema, so request bodies can be validated with the
 * schema tooling the project already ships. Unknown properties are rejected:
 * the windshift api ignores them, but a body carrying a field the contract does
 * not define means this trigger and the api disagree about the payload.
 */
function joiFromSpec(node: any): joi.Schema {
    if (node.$ref) {
        const name = node.$ref.replace('#/components/schemas/', '');
        return joiFromSpec((spec as any).components.schemas[name]);
    }
    switch (node.type) {
        case 'object': {
            const keys: Record<string, joi.Schema> = {};
            Object.entries(node.properties || {}).forEach(([key, value]) => {
                const required = (node.required || []).includes(key);
                const schema = joiFromSpec(value);
                keys[key] = required ? schema.required() : schema.optional();
            });
            return joi.object().keys(keys);
        }
        case 'array':
            return joi.array().items(joiFromSpec(node.items));
        case 'string': {
            let schema = joi.string();
            if (node.maxLength) {
                schema = schema.max(node.maxLength);
            }
            return schema;
        }
        case 'integer':
            return joi.number().integer();
        case 'number':
            return joi.number();
        case 'boolean':
            return joi.boolean();
        default:
            // A type this converter does not implement would otherwise validate
            // everything, so a corrupted excerpt would pass the contract check.
            throw new Error(
                `Unsupported type in the vendored contract: ${JSON.stringify(node.type)}`,
            );
    }
}

const itemCreateRequest = joiFromSpec({
    $ref: '#/components/schemas/ItemCreateRequest',
});

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

async function postedBodies(
    configurationOverrides: Record<string, unknown> = {},
) {
    const windshift = new Windshift();
    await windshift.register('trigger', 'windshift', 'contract', {
        url: 'https://windshift.example',
        token: 'crw_secret-token',
        workspace: 3,
        ...configurationOverrides,
    });
    await windshift.trigger(containerFixture());
    return axiosMock.mock.calls
        .map((call) => call[0])
        .filter((options) => options && options.method === 'POST');
}

describe('Windshift api contract (offline, against the vendored spec)', () => {
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

    test('the vendored excerpt names its source', () => {
        expect((spec as any)['x-wud-provenance'].source).toContain(
            'openapi.json',
        );
        expect((spec as any).servers[0].url).toEqual('/rest/api/v1');
    });

    test('an unimplemented schema type is refused by the converter (INFRA-123 review 5)', () => {
        expect(() => joiFromSpec({ type: 'strnig' })).toThrow(/strnig/);
        expect(() => joiFromSpec({ description: 'no type at all' })).toThrow(
            /type/,
        );
        // Positive control: the types the contract really uses convert.
        expect(() => joiFromSpec({ type: 'string' })).not.toThrow();
    });

    test('the create-item body validates against ItemCreateRequest', async () => {
        const bodies = await postedBodies();

        expect(bodies).toHaveLength(1);
        const { error } = itemCreateRequest.validate(bodies[0].data);
        expect(error).toBeUndefined();
    });

    test('an over-long title would breach the contract (validator control)', () => {
        const { error } = itemCreateRequest.validate({
            title: 'x'.repeat(256),
            workspace_id: 3,
        });
        expect(error?.message).toMatch(/title/);
    });

    test('a body missing workspace_id or carrying an unknown field is refused (validator control)', () => {
        expect(
            itemCreateRequest.validate({ title: 'a title' }).error?.message,
        ).toMatch(/workspace_id/);
        expect(
            itemCreateRequest.validate({
                title: 'a title',
                workspace_id: 3,
                workspace: 'INFRA',
            }).error?.message,
        ).toMatch(/workspace/);
    });

    test('the truncated title stays within the contract maxLength', async () => {
        const bodies = await postedBodies({ simpletitle: 'x'.repeat(400) });

        const { error } = itemCreateRequest.validate(bodies[0].data);
        expect(error).toBeUndefined();
    });

    test('the request targets the spec path and carries the BearerAuth header', async () => {
        const bodies = await postedBodies();
        const scheme = (spec as any).components.securitySchemes.BearerAuth;
        const server = (spec as any).servers[0].url;

        expect(scheme.in).toEqual('header');
        expect(bodies[0].url).toEqual(
            `https://windshift.example${server}/items`,
        );
        expect(bodies[0].headers[scheme.name]).toMatch(/^Bearer \S+$/);
        expect(Object.keys((spec as any).paths['/items'])).toContain('post');
    });
});

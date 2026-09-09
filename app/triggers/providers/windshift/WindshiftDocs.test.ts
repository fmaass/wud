import fs from 'fs';
import path from 'path';
import Windshift from './Windshift';

const DOCS_DIR = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'docs',
    'configuration',
    'triggers',
);
const README = path.join(DOCS_DIR, 'windshift', 'README.md');
const SIDEBAR = path.join(DOCS_DIR, 'sidebar.md');
const CHANGELOG = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'docs',
    'changelog',
    'README.md',
);

/**
 * The trigger-specific variables the README's variable TABLE documents,
 * lowercased. Only table rows count: the prose names common options too.
 */
function documentedVariables() {
    const rows = fs
        .readFileSync(README, 'utf-8')
        .split('\n')
        .filter((line) => line.startsWith('| `WUD_TRIGGER_WINDSHIFT_'));
    const names = rows.map((row) =>
        row.replace(
            /^\| `WUD_TRIGGER_WINDSHIFT_\{trigger_name\}_([A-Z]+)`.*/,
            '$1',
        ),
    );
    return [...new Set(names.map((name) => name.toLowerCase()))].sort();
}

/** The keys of the joi configuration schema. */
function schemaKeys() {
    const described: any = new Windshift().getConfigurationSchema().describe();
    return Object.keys(described.keys).sort();
}

describe('Windshift Trigger documentation', () => {
    test('the README documents exactly the schema keys', () => {
        expect(documentedVariables()).toEqual(schemaKeys());
    });

    test('the README states the required keys as the schema does', () => {
        const readme = fs.readFileSync(README, 'utf-8');
        const described: any = new Windshift()
            .getConfigurationSchema()
            .describe();
        Object.entries(described.keys).forEach(
            ([key, value]: [string, any]) => {
                const row = readme
                    .split('\n')
                    .find((line) =>
                        line.includes(
                            `WUD_TRIGGER_WINDSHIFT_{trigger_name}_${key.toUpperCase()}`,
                        ),
                    );
                expect(row).toBeDefined();
                const required =
                    value.flags && value.flags.presence === 'required';
                expect(row).toContain(
                    required ? ':red_circle:' : ':white_circle:',
                );
                if (value.flags && value.flags.default !== undefined) {
                    expect(row).toContain(`\`${value.flags.default}\``);
                }
            },
        );
    });

    test('the README explains the once=false recommendation and the scope', () => {
        const readme = fs.readFileSync(README, 'utf-8');
        expect(readme).toMatch(/ONCE=false/);
        expect(readme).toMatch(/minor/i);
        expect(readme).toMatch(/major/i);
    });

    test('the sidebar links the trigger alphabetically', () => {
        const entries = fs
            .readFileSync(SIDEBAR, 'utf-8')
            .split('\n')
            .filter((line) => line.includes('configuration/triggers/'))
            .map((line) => line.trim());
        expect(entries).toContain(
            '- [Windshift](configuration/triggers/windshift/)',
        );
        const names = entries
            .map((entry) => entry.replace(/^- \[(.*)\].*/, '$1'))
            .filter((name) => name !== 'Triggers');
        expect(names).toEqual([...names].sort());
    });

    test('the changelog announces the trigger in the next section', () => {
        const changelog = fs.readFileSync(CHANGELOG, 'utf-8');
        const next = changelog.split('##')[1];
        expect(next).toMatch(/WINDSHIFT/);
    });
});

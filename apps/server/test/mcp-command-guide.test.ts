import { describe, it, expect } from 'vitest';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import { nativeCommandGuide } from '../src/mcp/mcp-command-guide.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
describe('native command guidance', () => {
  it.each(['postgresql', 'mysql', 'sqlite', 'generic'] as const)(
    'provides valid complete examples for %s',
    (databaseKind) => {
      for (const command of [
        'add_table',
        'patch_table',
        'add_column',
        'patch_column',
        'add_table_reference',
      ]) {
        const guide = nativeCommandGuide({ command, databaseKind });
        const validate = new AjvJsonSchemaValidator().getValidator(guide.inputSchema);
        expect(guide.examples.length).toBeGreaterThan(0);
        for (const example of guide.examples) {
          expect(nativeEditorCommandSchema.safeParse(example).success).toBe(true);
          expect(validate(example).valid).toBe(true);
        }
      }
    },
  );
  it('exposes a standalone schema for every runtime command', () => {
    for (const option of nativeEditorCommandSchema.options) {
      const guide = nativeCommandGuide({
        command: option.shape.type.value,
        databaseKind: 'postgresql',
      });
      expect(() => new AjvJsonSchemaValidator().getValidator(guide.inputSchema)).not.toThrow();
    }
    expect(() =>
      nativeCommandGuide({ command: 'upsert_table', databaseKind: 'postgresql' }),
    ).toThrow();
  });
});

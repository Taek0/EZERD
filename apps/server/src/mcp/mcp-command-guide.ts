import { z } from 'zod';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import { createNativeTable, createNativeColumn, defaultDatabaseContext } from '@ezerd/model';
import { mcpSchemaMetadata } from './mcp-schema-metadata.js';

const commandNames = nativeEditorCommandSchema.options.map((option) => option.shape.type.value);
export const commandGuideInput = z.strictObject({
  command: z.enum(commandNames as [string, ...string[]]),
  databaseKind: z.enum(['postgresql', 'mysql', 'sqlite', 'generic']),
});
export const commandGuideOutput = z.object({
  command: z.string(),
  databaseKind: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  examples: z.array(z.record(z.string(), z.unknown())),
  notes: z.array(z.string()),
});
export const nativeWriteGuidance =
  '쓰기 전 get_native_command_guide(command,databaseKind)로 해당 명령의 상세 스키마와 예시를 확인하세요. ' +
  'list_tables/get_project_view의 logicalName/physicalName은 조회 요약이며 쓰기 value에 복사하지 마세요. ' +
  'add_table은 완전한 value(id,domainId,scope,logical:{name,definition},physical:{name,namespace,comment,options},customProperties:{common:{},logical:{},physical:{}})가 필요합니다. ' +
  'logicalName 및 최상위 comment는 금지하며 각각 logical.name, physical.comment를 사용하세요. ' +
  '기존 테이블 수정은 {type:"patch_table",id:"기존ID",patch:{logical:{name:"새 이름"},physical:{comment:"설명"}}}처럼 변경할 속성만 보내세요. ' +
  'PostgreSQL namespace/options는 {kind:"postgresSchema",name:"public"}/{database:"postgresql"}, MySQL은 {kind:"mysqlCurrentDatabase"}/{database:"mysql",engine:"InnoDB"}, SQLite는 {kind:"sqliteMain"}/{database:"sqlite",strict:false,withoutRowid:false}, generic은 {kind:"generic"}/{database:"generic"}입니다. ';

export function nativeCommandGuide(raw: z.input<typeof commandGuideInput>) {
  const input = commandGuideInput.parse(raw);
  const schema = nativeEditorCommandSchema.options.find(
    (option) => option.shape.type.value === input.command,
  )!;
  const context = defaultDatabaseContext(input.databaseKind);
  const table = createNativeTable(context, 'example-table');
  table.logical.name = '사용자';
  table.physical.name = 'users';
  const column = createNativeColumn(context, table, 'example-column');
  column.logical.name = '식별자';
  column.physical.name = 'id';
  const samples: Record<string, unknown[]> = {
    add_table: [{ type: 'add_table', value: table }],
    patch_table: [
      {
        type: 'patch_table',
        id: table.id,
        patch: { logical: { name: '사용자' }, physical: { comment: '사용자 정보' } },
      },
    ],
    add_column: [{ type: 'add_column', value: column }],
    patch_column: [
      { type: 'patch_column', id: column.id, patch: { physical: { comment: '식별자' } } },
    ],
    add_table_reference: [
      {
        type: 'add_table_reference',
        tableId: table.id,
        viewId: '__tables__',
        placement: { x: 200, y: 200, width: 400, height: 260 },
      },
    ],
  };
  const examples = (samples[input.command] ?? []).map((sample) =>
    nativeEditorCommandSchema.parse(sample),
  );
  return commandGuideOutput.parse({
    ...input,
    inputSchema: mcpSchemaMetadata(schema),
    examples,
    notes: [
      nativeWriteGuidance,
      'examples는 commands 배열의 개별 항목입니다. 예시 ID는 실제 객체 ID 또는 충돌 없는 새 ID로 바꾸세요. add_table 이후 배치는 별도 add_table_reference, 컬럼은 add_column으로 추가하세요.',
      'projectId와 expectedVersion/expectedSequence/expectedDatabaseRevision은 최신 조회 결과를 사용하고 operationId/groupId/clientId는 유효한 UUID를 사용하세요. DB 기능 지원 여부는 get_project_database_capabilities로 확인하세요.',
      ...(examples.length
        ? []
        : [
            '이 명령은 예시를 제공하지 않습니다. inputSchema의 필수 필드와 현재 객체 상세를 확인하세요.',
          ]),
    ],
  });
}

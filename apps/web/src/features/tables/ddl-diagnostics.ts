import { translate } from '../../shared/i18n/index.js';
import './translations.js';
import type { DesignDocument, Table } from '@ezerd/model';
type Destination = { viewId: string; objectId: string; x: number; y: number };
export function diagnosticTarget(
  document: DesignDocument,
  objectId: string,
): { label: string; target: Destination | null } {
  const tableName = (table: Table) =>
    table.physical.name.trim() || table.logical.name.trim() || translate('이름 없는 테이블');
  const column = document.columns?.find((item) => item.id === objectId);
  const key = document.keys?.find((item) => item.id === objectId);
  const relation = document.tableRelations?.find((item) => item.id === objectId);
  const table = document.tables?.find(
    (item) => item.id === (column?.tableId ?? key?.tableId ?? relation?.sourceTableId ?? objectId),
  );
  const domain = document.domains.find((item) => item.id === (table?.domainId ?? objectId));
  let label = translate('설계 전체');
  if (table) {
    label = tableName(table);
    if (column)
      label += ` / ${column.physical.name.trim() || column.logical.name.trim() || translate('이름 없는 컬럼')}`;
    if (key)
      label += ` / ${key.name.trim() || (key.kind === 'primary' ? translate('기본 키') : translate('고유 키'))}`;
  } else if (domain) label = domain.name.trim() || translate('이름 없는 도메인');
  if (relation)
    label =
      relation.physical?.name.trim() ||
      relation.logical.name.trim() ||
      translate('이름 없는 테이블 관계');
  const node =
    (table &&
      document.layout.nodes.find(
        (item) => item.objectId === table.id && item.viewId === table.domainId,
      )) ||
    (domain &&
      document.layout.nodes.find(
        (item) => item.objectId === domain.id && item.viewId === 'overview',
      ));
  return {
    label,
    target: node
      ? { viewId: node.viewId, objectId: node.objectId, x: node.width / 2, y: node.height / 2 }
      : null,
  };
}

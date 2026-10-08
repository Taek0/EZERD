/** Version-independent diagram structure shared by legacy and Native documents. */
export type ModelScope = 'both' | 'logical' | 'physical';

export type ViewMode = ModelScope;

export const TABLES_VIEW_ID = '__tables__';

export interface CustomProperties {
  common: Record<string, string>;
  logical: Record<string, string>;
  physical: Record<string, string>;
}

export interface ProjectEnum {
  id: string;
  name: string;
  schema: string;
  values: string[];
}

export interface RelationCardinality {
  min: 0 | 1;
  max: 1 | 'many';
}

export interface TableKey {
  id: string;
  tableId: string;
  scope: ModelScope;
  kind: 'primary' | 'unique';
  name: string;
  columnIds: string[];
}

export type ReferentialAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

export interface TableRelation {
  id: string;
  sourceTableId: string;
  targetTableId: string;
  scope: ModelScope;
  logical: {
    name: string;
    cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
    required: boolean;
    description?: string | undefined;
    sourceCardinality?: RelationCardinality | undefined;
    targetCardinality?: RelationCardinality | undefined;
  };
  physical: null | {
    name: string;
    sourceColumnIds: string[];
    targetColumnIds: string[];
    onDelete: ReferentialAction;
    onUpdate: ReferentialAction;
  };
}

export interface Domain {
  id: string;
  name: string;
  description: string;
  color?: string | undefined;
}

export interface DomainRelation {
  id: string;
  sourceDomainId: string;
  targetDomainId: string;
  name: string;
  direction: 'forward' | 'both';
  description: string;
}

export interface Note {
  id: string;
  viewId: string;
  text: string;
  color?: string | undefined;
}

export interface Position {
  x: number;
  y: number;
}

export interface NodeLayout extends Position {
  id: string;
  objectId: string;
  viewId: string;
  width: number;
  height: number;
}

export interface Viewport extends Position {
  viewId: string;
  zoom: number;
}

export interface CombinedView {
  id: string;
  name: string;
  domainIds: string[];
}

export interface RelationAnchor {
  side: 'left' | 'right' | 'top' | 'bottom';
  ratio: number;
}

export interface RelationLayout {
  relationId: string;
  viewId: string;
  offset: number;
  bend?: Position | undefined;
  sourceAnchor?: RelationAnchor | undefined;
  targetAnchor?: RelationAnchor | undefined;
  waypoints?: Position[] | undefined;
}

export interface TableBase {
  canvasDisplay?:
    { showNullable?: boolean | undefined; showComment?: boolean | undefined } | undefined;
  id: string;
  domainId: string | null;
  color?: string | undefined;
  scope: ModelScope;
  logical: { name: string; definition: string };
  customProperties: CustomProperties;
}

export interface ColumnBase {
  id: string;
  tableId: string;
  scope: ModelScope;
  logical: { name: string; definition: string; semanticType: string; required: boolean };
  customProperties: CustomProperties;
}

export type DocumentLayout = {
  nodes: NodeLayout[];
  viewports: Viewport[];
  relations?: RelationLayout[] | undefined;
};

export interface DocumentBase {
  views?: CombinedView[] | undefined;
  domains: Domain[];
  domainRelations: DomainRelation[];
  notes: Note[];
  enums?: ProjectEnum[] | undefined;
  layout: DocumentLayout;
}

/** Allocate independent collections; optional sections stay absent until first use. */
export function createEmptyDocumentBase(): DocumentBase {
  return {
    domains: [],
    domainRelations: [],
    notes: [],
    layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
  };
}

/** Canvas commands inspect ownership and identity, never database physical payloads. */
export interface CanvasDocument extends Pick<
  DocumentBase,
  'domains' | 'domainRelations' | 'notes' | 'views' | 'layout'
> {
  schemaVersion?: 1 | 2;
  tables?: readonly { id: string; domainId: string | null }[] | undefined;
  columns?: readonly { id: string }[] | undefined;
  keys?: readonly { id: string }[] | undefined;
  enums?: readonly { id: string }[] | undefined;
  indexes?: readonly { id: string }[] | undefined;
  checks?: readonly { id: string }[] | undefined;
  tableRelations?:
    readonly { id: string; sourceTableId: string; targetTableId: string }[] | undefined;
}

export interface TableCanvasDocument {
  tables?: readonly { id: string; domainId: string | null }[] | undefined;
  layout: DocumentLayout;
}

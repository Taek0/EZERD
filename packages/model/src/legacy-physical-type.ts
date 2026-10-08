/** Raw v1 column type retained for file migration and Native legacy evidence. */
export type LegacyPhysicalType = {
  name: string;
  enumId?: string | undefined;
  length?: number | undefined;
  precision?: number | undefined;
  scale?: number | undefined;
  isArray: boolean;
};

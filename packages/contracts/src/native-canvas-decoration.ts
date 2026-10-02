import { z } from 'zod';
import { domainRelationSchema, domainSchema } from './workspace.js';
import type { DomainRelation } from '@ezerd/model';
const id = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim() && value !== 'overview' && value !== '__tables__');
const relation = domainRelationSchema
  .extend({ id, sourceDomainId: id, targetDomainId: id })
  .transform((value) => value as DomainRelation);
const relationPatch = domainRelationSchema
  .omit({ id: true })
  .extend({ sourceDomainId: id, targetDomainId: id })
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined))
  .transform((value) => value as Partial<Omit<DomainRelation, 'id'>>);
export const nativeDomainRelationCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('add_domain_relation'), value: relation }),
  z.strictObject({ type: z.literal('patch_domain_relation'), id, patch: relationPatch }),
  z.strictObject({ type: z.literal('delete_domain_relation'), id }),
]);
export type NativeDomainRelationCommand = z.output<typeof nativeDomainRelationCommandSchema>;
const color = domainSchema.shape.color.unwrap().nullable();
const display = z
  .strictObject({ showNullable: z.boolean().optional(), showComment: z.boolean().optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined))
  .transform((value) => value as { showNullable?: boolean; showComment?: boolean });
export const nativeCanvasStyleCommandSchema = z
  .strictObject({
    type: z.literal('patch_canvas_style'),
    target: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('table'), id }),
      z.strictObject({ kind: z.literal('domain'), id }),
      z.strictObject({ kind: z.literal('note'), id }),
    ]),
    patch: z
      .strictObject({ color: color.optional(), canvasDisplay: display.optional() })
      .refine((value) => Object.values(value).some((field) => field !== undefined)),
  })
  .superRefine((command, ctx) => {
    if (command.target.kind !== 'table' && command.patch.canvasDisplay)
      ctx.addIssue({ code: 'custom', message: 'canvas.table-style-required' });
  });
export type NativeCanvasStyleCommand = z.output<typeof nativeCanvasStyleCommandSchema>;
export const nativeCanvasDecorationCommandSchema = z.union([
  nativeDomainRelationCommandSchema,
  nativeCanvasStyleCommandSchema,
]);
export type NativeCanvasDecorationCommand = z.output<typeof nativeCanvasDecorationCommandSchema>;

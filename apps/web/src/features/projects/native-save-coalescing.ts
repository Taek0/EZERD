import { nativePendingSaveSchema } from '@ezerd/contracts';
import type { NativeWebCommand } from './native-save.js';

/** Only assignments without identity, type, scope or structural side effects may be collapsed. */
function coalescingKey(command: NativeWebCommand): string | null {
  if (command.type === 'update_node_layout')
    return Object.values(command.patch).some((value) => value === undefined)
      ? null
      : `node:${command.nodeId}`;
  if (command.type !== 'patch_table' && command.type !== 'patch_column') return null;
  const patch = command.patch;
  // JSON omits explicit undefined. Folding it over an earlier value would erase that assignment.
  if (
    Object.values(patch).some((value) => value === undefined) ||
    Object.values(patch.logical ?? {}).some((value) => value === undefined) ||
    Object.values(patch.physical ?? {}).some((value) => value === undefined)
  )
    return null;
  if (Object.keys(patch).some((key) => key !== 'logical' && key !== 'physical')) return null;
  if (Object.keys(patch.logical ?? {}).some((key) => key !== 'name' && key !== 'definition'))
    return null;
  if (Object.keys(patch.physical ?? {}).some((key) => key !== 'comment')) return null;
  return `${command.type}:${command.id}`;
}

function compact(commands: readonly NativeWebCommand[]): NativeWebCommand[] {
  const output: NativeWebCommand[] = [];
  for (const original of commands) {
    const command = structuredClone(original),
      previous = output.at(-1),
      key = coalescingKey(command);
    if (!previous || key === null || key !== coalescingKey(previous)) {
      output.push(command);
      continue;
    }
    if (command.type === 'update_node_layout' && previous.type === 'update_node_layout') {
      previous.patch = { ...previous.patch, ...command.patch };
    } else if (
      (command.type === 'patch_table' && previous.type === 'patch_table') ||
      (command.type === 'patch_column' && previous.type === 'patch_column')
    ) {
      previous.patch = {
        ...previous.patch,
        ...(command.patch.logical
          ? { logical: { ...previous.patch.logical, ...command.patch.logical } }
          : {}),
        ...(command.patch.physical
          ? { physical: { ...previous.patch.physical, ...command.patch.physical } }
          : {}),
      };
    }
  }
  return output;
}

/** Validate every original command before folding; call only before assigning an operationId. */
export function coalesceNativeSaveCommands(
  commands: readonly NativeWebCommand[],
): NativeWebCommand[] {
  return compact(nativePendingSaveSchema.shape.request.shape.commands.parse(commands));
}

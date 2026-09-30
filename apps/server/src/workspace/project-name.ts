const baseName = '새 프로젝트';

/** Includes archived names; missing numbers are not filled before the greatest suffix. */
export function nextAutomaticProjectName(names: readonly string[]): string {
  let maximum = -1n;
  for (const name of names) {
    if (name === baseName && maximum < 0n) maximum = 0n;
    const suffix = /^새 프로젝트 ([1-9][0-9]*)$/.exec(name)?.[1];
    if (suffix !== undefined && BigInt(suffix) > maximum) maximum = BigInt(suffix);
  }
  return maximum < 0n ? baseName : `${baseName} ${maximum + 1n}`;
}

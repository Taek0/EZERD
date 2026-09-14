import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const manifests = ['package.json', 'apps/web/package.json', 'apps/server/package.json', 'packages/model/package.json', 'packages/contracts/package.json'];
const list = spawnSync(
  process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm list --recursive --depth Infinity --json'] : ['list', '--recursive', '--depth', 'Infinity', '--json'],
  { cwd: fileURLToPath(root), encoding: 'utf8' },
);
if (list.error) throw list.error;
if (list.status !== 0) throw new Error(list.stderr || 'pnpm list failed');
const installed = new Set();
const walk = node => {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'unsavedDependencies']) {
    for (const [name, dependency] of Object.entries(node[field] ?? {})) {
      if (!dependency.version.startsWith('link:')) installed.add(`${name}@${dependency.version}`);
      walk(dependency);
    }
  }
};
JSON.parse(list.stdout).forEach(walk);

const lock = await readFile(new URL('pnpm-lock.yaml', root), 'utf8');
// Read only package keys in pnpm lockfile v9. Fail rather than guessing a new format.
if (!/^lockfileVersion: ['"]?9\.0['"]?$/m.test(lock)) throw new Error('Unsupported lockfile format');
const section = lock.split('\npackages:\n')[1]?.split('\nsnapshots:\n')[0];
if (!section) throw new Error('Missing lockfile packages section');
const entries = [...section.matchAll(/^  (?:'([^']+)'|([^\s][^\n]*)):\s*$/gm)].map(match => match[1] ?? match[2]).sort();
if (!entries.length) throw new Error('No locked package entries found');
const hash = createHash('sha256').update(lock).digest('hex');
let output = '# 패키지 버전 전체 목록\n\n';
output += '이 파일은 `pnpm docs:versions`로 생성합니다. 의존성 설치·변경 후 다시 실행하고 함께 커밋합니다.\n\n';
output += `- 기준 lockfile: \`pnpm-lock.yaml\` (형식 9.0)\n- lockfile SHA-256: \`${hash}\`\n`;
output += `- 전체 잠금 항목: **${entries.length}개** (패키지명 + 버전 기준, OS별 선택 의존성 포함)\n`;
output += '- 설치 표시: 현재 PC에서 `pnpm list --recursive --depth Infinity --json`으로 확인한 의존성 그래프 기준. 다른 OS에서는 달라질 수 있습니다.\n\n';
output += '## 직접 의존성과 내부 패키지\n\n';
for (const path of manifests) {
  const manifest = JSON.parse(await readFile(new URL(path, root), 'utf8'));
  output += `### ${manifest.name} · ${manifest.version}\n\n정의: [${path}](../${path})\n\n`;
  output += '| 패키지 | 고정 버전 / 연결 규칙 | 구분 |\n| --- | --- | --- |\n';
  let count = 0;
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {}).sort()) {
      output += `| \`${name}\` | \`${version}\` | ${version.startsWith('workspace:') ? '내부 패키지 연결' : field === 'devDependencies' ? '개발' : '실행'} |\n`;
      count++;
    }
  }
  if (!count) output += '| 외부 직접 의존성 없음 | — | 루트 개발 도구 사용 |\n';
  output += '\n';
}
output += '## 전체 잠금 버전\n\n동일 패키지의 여러 버전은 별도 행으로 기록합니다. peer 의존성 조합과 무결성 해시는 원본 lockfile에서 확인합니다.\n\n';
output += '| 패키지 | 버전 | 현재 설치 그래프 |\n| --- | --- | --- |\n';
for (const entry of entries) {
  const separator = entry.lastIndexOf('@');
  if (separator < 1) throw new Error(`Unexpected package key: ${entry}`);
  output += `| \`${entry.slice(0, separator)}\` | \`${entry.slice(separator + 1)}\` | ${installed.has(entry) ? '확인' : '잠금 목록만'} |\n`;
}
await writeFile(new URL('docs/DEPENDENCY_VERSIONS.md', root), output);
console.log(`Documented ${entries.length} locked package versions and ${manifests.length} workspace manifests.`);

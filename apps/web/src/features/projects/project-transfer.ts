import { translate as t } from '../../shared/i18n/index.js';
import '../collaboration/translations.js';
import { diagnoseDocument, type DesignDocument } from '@ezerd/model';
import {
  projectTransferSchema,
  MAX_PROJECT_TRANSFER_BYTES,
  type ProjectTransfer,
} from '@ezerd/contracts';

export function parseProjectTransfer(text: string): ProjectTransfer {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_TRANSFER_BYTES)
    throw new Error(t('프로젝트 파일은 2 MB까지 가져올 수 있습니다.'));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t('올바른 JSON 프로젝트 파일을 선택해 주세요.'));
  }
  if (typeof raw === 'object' && raw !== null && 'formatVersion' in raw && raw.formatVersion !== 1)
    throw new Error(t('지원하지 않는 프로젝트 파일 버전입니다. 버전 1 파일을 선택해 주세요.'));
  const parsed = projectTransferSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(t('프로젝트 파일 형식 또는 설계 데이터가 올바르지 않습니다.'));
  const issue = diagnoseDocument(parsed.data.document as DesignDocument)[0];
  if (issue)
    throw new Error(t('설계 데이터를 확인해 주세요: {message}', { message: issue.message }));
  return parsed.data;
}

export function projectTransferFilename(name: string): string {
  return `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'project'}.ezerd.json`;
}

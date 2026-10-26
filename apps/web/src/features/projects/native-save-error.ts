import { ApiError, apiDiagnostic, message, type ApiDiagnostic } from '../../shared/api/client.js';
import { registerTranslations, translate as t } from '../../shared/i18n/index.js';

registerTranslations({
  '저장이 거부되었습니다. 입력을 보관한 뒤 최신 설계를 확인해 주세요.':
    'Save was rejected. Keep your input and check the latest design.',
  '설계 또는 저장 요청이 허용 크기를 초과했습니다.':
    'The design or save request exceeds the size limit.',
  '저장할 항목의 형식이나 값을 확인해 주세요.':
    'Check the format or value of the items being saved.',
  '다른 변경과 충돌했습니다. 최신 설계를 확인해 주세요.':
    'The save conflicts with another change. Check the latest design.',
  'DB 설정이 변경되었습니다. 최신 설계를 다시 불러와 주세요.':
    'Database settings changed. Reload the latest design.',
  '이전에 삭제된 항목과 충돌하여 저장하지 못했습니다.':
    'The save conflicts with a previously deleted item.',
  '확인 위치: {path}': 'Check field: {path}',
  '오류 코드: {code}': 'Error code: {code}',
  '요청 ID: {id}': 'Request ID: {id}',
});

export function nativeSaveRejectionMessage(input?: ApiDiagnostic): string {
  const diagnostic = apiDiagnostic(input);
  const codes = [diagnostic.code, ...(diagnostic.issues ?? []).map((issue) => issue.code)];
  const reason = codes.some((code) => code?.endsWith('.size-limit'))
    ? t('설계 또는 저장 요청이 허용 크기를 초과했습니다.')
    : codes.includes('sync.identity-retired')
      ? t('이전에 삭제된 항목과 충돌하여 저장하지 못했습니다.')
      : codes.includes('database.context-changed')
        ? t('DB 설정이 변경되었습니다. 최신 설계를 다시 불러와 주세요.')
        : codes.some((code) => code?.includes('conflict'))
          ? t('다른 변경과 충돌했습니다. 최신 설계를 확인해 주세요.')
          : diagnostic.issues?.length || diagnostic.code === 'sync.input-invalid'
            ? t('저장할 항목의 형식이나 값을 확인해 주세요.')
            : t('저장이 거부되었습니다. 입력을 보관한 뒤 최신 설계를 확인해 주세요.');
  return [
    reason,
    ...(diagnostic.issues?.map((issue) =>
      [
        issue.path ? t('확인 위치: {path}', { path: issue.path }) : '',
        issue.code ? t('오류 코드: {code}', { code: issue.code }) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ) ?? []),
    diagnostic.code ? t('오류 코드: {code}', { code: diagnostic.code }) : '',
    diagnostic.requestId ? t('요청 ID: {id}', { id: diagnostic.requestId }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function nativeSaveErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? nativeSaveRejectionMessage({ ...error.diagnostic, code: error.code })
    : message(error);
}

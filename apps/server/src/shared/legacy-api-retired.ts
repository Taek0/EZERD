import { GoneException } from '@nestjs/common';

export function legacyApiRetired(): GoneException {
  return new GoneException({
    code: 'document.legacy-api-retired',
    message: 'v1 조회·편집 API는 종료되었습니다. Native API를 사용해주세요.',
  });
}

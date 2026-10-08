# 저장 문서 타입 정리

- [최종 계획](../planning/2026-10-07-Legacy-FinalRegressionPlan.md)의 첫 단위를 완료했다.
- model의 StoredDesignDocument를 DesignDocument | NativeDesignDocument로 정의하고 projects.document, sync_client_baselines.document의 JSONB TypeScript 타입에 적용했다.
- Native 프로젝트 생성은 이제 정확한 저장 타입에 직접 대입한다. 이전 as unknown as ProjectRow['document'] 캐스팅과 오래된 v1 타입 설명을 제거했다.
- requireLegacyServerDocument는 저장 문서 union을 명시적으로 v1으로 좁힌다. normalizeServerDocument는 union을 받아 Native 원본에 대해서는 기존 409 거부를 유지한다.
- DB 열·기본값·migration·사용자 데이터는 변경하지 않았다. 제품 생성/가져오기는 Native 문서를 명시적으로 저장하며, DB의 과거 v1 default 정책은 이번 타입 정리와 별개다.
- pnpm typecheck와 집중 테스트 15개, pnpm format, git diff --check 통과. 테스트에서 실제 TypeScript 컴파일러로 두 JSONB 필드의 v1/v2 허용·미지원 버전 거부·legacy 타입 좁힘을 확인했다.
- 다음 단위에서 잔여 QA 분류와 전체 자동 회귀를 수행한다. docs/EZERD.txt는 수정하지 않았다.

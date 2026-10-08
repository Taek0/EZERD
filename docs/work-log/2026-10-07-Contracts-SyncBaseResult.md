# 공통 동기화 계약 분리 완료

- [계획](../planning/2026-10-07-Contracts-SyncBasePlan.md)에 따라 공통 메타데이터, v1 호환 envelope, 버전 혼합 reader를 분리했다.
- sync-base.ts는 path/change/actor/status/baseline과 문서 형식이 없는 input/result/event 메타데이터 필드를 제공한다.
- native-sync.ts는 공통 필드와 Native 문서 스키마를 직접 조합한다. 더 이상 v1 syncOperationInputSchema/syncOperationResultSchema를 extend하지 않는다. Native의 필수 protocol/database/revision, 문맥 비교 및 accepted baseline revision 일치 검증은 유지했다.
- legacy-sync.ts에는 과거 v1 envelope 파서를 보존했다. sync.ts는 호환 re-export로 기존 이름과 경로를 유지하며, 폐기된 v1 API를 다시 등록하지 않는다.
- sync-read.ts에 v1/v2 input/result/event union reader를 모았다. Native 이력과 취소 ACK 읽기는 해당 reader를 명시적으로 사용하며, 원문을 반환하는 기존 z.custom 검증 방식을 유지한다.
- 패키지 public export의 reader 이름은 유지했다. 내부 native-sync.ts에서 reader를 직접 가져오던 코드는 sync-read.ts로 옮겨 Native 모듈→reader→Native 모듈 순환을 피했다.
- “live v1 endpoint”라는 오래된 주석을 현재 구조에 맞게 수정했다.

## 동작 동일성 확인

- 분리 전 빌드된 계약과 분리 후 계약에 동일한 **537개 입력 사례**를 적용했다. 성공/실패 여부 및 파싱 결과·오류 issues의 JSON 직렬화 결과 차이는 **0개**였다.
- 비교 대상은 v1/Native input/result/event, 공통/Native baseline, Native snapshot과 버전 혼합 reader다. 누락·undefined·null·알 수 없는 필드, 숫자 경계, DB 종류, 중복/잘못된 경로·변경 개수 등을 포함한다. 전체 가능한 입력을 증명하는 것은 아니며 아래 회귀 테스트로 보완했다.
- 영구 테스트에 기존 public export·sync 경로 호환, Native 계약의 legacy envelope/혼합 reader 비의존성, 공통 기본값·필드 존재·중복 경로·개수 제한을 추가했다.
- 기존 Native 문맥 불일치·revision·원문 보존, 역사적 이력과 취소 ACK 관련 검증도 유지했다.

## 최종 검증

- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 전체 테스트: 203개 파일/2,584개 테스트 통과, 25개 파일/491개 테스트 건너뜀.
- 격리 DB에서 versioned-document, native-history, native-cancellation 통합 테스트 **135개 모두 통과**했다. 실제 REST/MCP 저장·재생·이력/복구·취소 및 과거 ACK 읽기를 검증했다.
- 임시 DB는 test-isolated.ts가 생성·마이그레이션·정리했다. 비교용 임시 스크립트와 JSON 결과도 정리했다.
- 웹 빌드: JS 1,753.70kB(gzip 497.35kB), CSS 130.32kB(gzip 25.50kB), 1,631모듈. 기존 500kB 청크 경고는 남는다.
- apps 구현·model·DB 스키마/데이터·docs/EZERD.txt는 변경하지 않았다. 브라우저 수동 QA, 서버 재시작·배포는 수행하지 않았다.
- 과거 v1 reader와 파일 호환 코드는 의도적으로 남긴 상태다. 남은 미사용 호환 reader/함수 제거는 소비자를 다시 확인해 별도 단위로 진행할 수 있다.

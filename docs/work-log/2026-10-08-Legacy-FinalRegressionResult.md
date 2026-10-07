# v1 정리 최종 자동 회귀 결과

- [최종 계획](../planning/2026-10-07-Legacy-FinalRegressionPlan.md)의 코드 정리와 자동 회귀 검증을 완료했다.
- DB 저장 타입 정리는 [별도 기록](2026-10-07-Legacy-StoredDocumentTypingResult.md)과 8ad5c51에 포함했다. 저장 문서 union 및 legacy 타입 좁힘을 적용했으며 DB 열·기본값·사용자 데이터는 변경하지 않았다.

## 잔여 QA 정리

- 종료된 PUT document 또는 v1 baseline/operations를 정상 호출한다는 전제로 작성된 스크립트 10개를 제거했다.
- scripts/browser-editor-persistence-smoke.mjs, browser-panel-smoke.mjs, browser-project-feedback-smoke.mjs, browser-release-smoke.mjs, browser-smoke.mjs.
- scripts/prepare-defaults-domain-qa.mjs, prepare-dense-canvas-qa.mjs, prepare-editor-feedback-qa.mjs, prepare-responsive-qa.mjs 및 apps/server/scripts/workspace-preview.mjs.
- 해당 스크립트는 현재 v1 진입 폐기 상태에서 정상 실행할 수 없는 과거 전체 화면/저장 흐름이었다. 관련 Native 화면·저장·리뷰·권한 테스트와 공통 컴포넌트는 유지했다. 브라우저 단위 스크립트 삭제를 실제 브라우저 검증 완료로 주장하지 않는다.
- browser-ui-smoke와 browser-pin-filter-smoke 같은 공통 UI/댓글 검증, 기존 v1 PostgreSQL DDL verifier, 현재 ERD 파일 생성 도구, 명시적 workspace transfer 도구는 보존했다. v1 fixture 또는 문자열 버전 표기가 있다는 이유로 일괄 제거하지 않았다.
- 현재 코드·스크립트·README·package 명령에서 삭제된 QA 실행 참조는 발견되지 않았다. 과거 작업 기록은 당시 이력으로 보존한다.

## 통합 테스트 갱신

- Native canvas parity 및 project creation에서 폐기된 GET project의 409/200 기대값을 410으로 갱신했다.
- 기존 파일 import는 Native v2 생성으로 검사하고, 과거 v1 원본 읽기는 DB fixture를 별도로 준비해 source 보존을 확인한다.
- workspace.integration은 Native baseline/operations/history/export와 Native 개인 상태 동시성 문맥을 사용한다. viewer의 신규 baseline·설계 쓰기는 거부하고, 읽기 권한이 남은 같은 actor의 이전 ACK 재생은 원본 그대로 반환하며 상태를 변경하지 않는지 검증한다.
- 프로젝트 갤러리 파일 roundtrip은 NativeTransferService로 전환했다. 기존 legacy 메타데이터/HTTP export 호환 fixture는 유지했다.

## 재현 가능한 최종 명령

- `pnpm check`: 포맷·타입·전체 테스트·빌드.
- `pnpm test:regression`: 빌드 후 모든 `*.integration.test.ts`를 수집한다. 일반 Native/API는 test-isolated.ts의 ezerd_qa_ 임시 DB, workspace 전용 3개 스위트는 test-workspaces.mjs의 ezerd_workspace_test_ 임시 DB에서 실행한다. 각 실행기는 로컬 DB만 허용하고 만든 DB를 정리한다.
- 기존 단일 실행기로 전체 스위트를 돌렸을 때 일부 안전 prefix 검사와 과거 계약 기대값이 실패했다. 요구하는 실행기를 분리하고 기대값을 현재 Native 계약으로 수정한 뒤 전체 스위트를 재검증했다.
- README와 package.json에 새 최종 회귀 명령을 안내했다.

## 최종 결과

| 검증 | 결과 |
| --- | --- |
| pnpm check | 통과 |
| 기본 전체 테스트 | 205개 파일/2,592개 테스트 통과, 25개 파일/496개 테스트 건너뜀 |
| Native/API 격리 DB | 23개 스위트/482개 테스트 모두 통과 |
| Workspace 격리 DB | 3개 스위트/15개 테스트 모두 통과 |
| 전체 DB 통합 합계 | **26개 스위트/497개 테스트 모두 통과** |
| git diff --check | 통과 |

- 별도 MCP 작업의 540a29a까지 공유 체크아웃에 반영된 뒤 최종 pnpm check와 DB 회귀를 다시 확인했다. 해당 MCP 소스 변경은 이 작업의 커밋에 포함하지 않는다.
- 실제 저장소는 임시 PostgreSQL이다. Native MySQL/SQLite 문맥의 모델·저장 정책 검증을 포함하지만 별도 MySQL/SQLite 서버를 새로 실행했다는 의미는 아니다.
- 웹 JS/CSS는 이 단계 시작과 같은 index-CUO2bA2U.js와 index-B8eXxYp3.css이다. 기존 Vite 청크 크기 및 테스트 실행기의 Node shell 경고는 있으나 검증은 성공했다.

## 완료 범위와 의도적으로 유지한 호환

- 합의한 **v1 운영 경로 정리·Native 의존성 분리·최종 자동 회귀 범위는 완료**다. v1 UI/전용 API/MCP는 폐기됐으며 새 생성과 파일 가져오기는 Native를 사용한다.
- 파일 reader/migration, 원문 증거 검증, 과거 이력/ACK 읽기, 기존 저장 문서 export 및 그 테스트 fixture는 계속 필요하므로 유지한다. DB의 과거 JSON default 정책도 이번 작업에서 변경하지 않았다.
- 수동 브라우저 QA, 실제 서버 재시작·배포, 기존 프로젝트 일괄 변환은 수행하지 않았다. 자동 검증 완료를 모든 실제 사용자 환경의 무결성 보장으로 해석하지 않는다.
- 사용자 DB와 docs/EZERD.txt는 수정하지 않았다. 임시 테스트 DB는 실행기가 정리했다.

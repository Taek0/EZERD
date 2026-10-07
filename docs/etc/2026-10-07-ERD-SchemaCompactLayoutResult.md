# 현재 코드 ERD 최신화 및 균형 배치 결과

## 반영 대상과 스키마

- TY 공간의 기존 `EZERD` 프로젝트(`169ab1bb-b2e7-4db7-8112-f927ec4c3334`)를 갱신했다.
- 현재 원격 설계는 native v2이다. 기존 get_project_summary/get_project_view는 버전 오류를 반환하므로 get_project_document_state의 전체 원본과 get_personal_state를 읽어 비교·검증했다.
- 추가 테이블: `project_database_operations`, `native_request_cancellations`.
- 기존 테이블 추가 컬럼: `projects.database_profile_id`, `projects.database_revision`, `sync_client_baselines.database_revision`.
- 새 테이블 컬럼 17개를 포함하여 총 컬럼 20개, 키 2개, FK 4개를 추가했다.
- 최종 합계: 테이블 19개, 컬럼 142개, PK/UNIQUE 키 24개, FK 28개, ENUM 5개.
- Drizzle 정의를 새로 읽고 v1→v2 순수 변환 결과와 저장된 물리 정의를 대조했다. 스키마 차이와 native 검증 문제는 0건이다.
- 프로젝트 CHECK 설명 등 물리 메타데이터와 추가 FK에 해당하는 도메인 설명·관계 설명도 갱신했다. 일반 인덱스/조건부 인덱스/CHECK는 기존처럼 customProperties에 보존하며 참고 DDL이 이를 모두 재현하는 것은 아니다.

## 화면과 배치

- 기존 개인 `all-tables` 화면은 현재 인증 도메인만 포함하고 있어 그대로 보존했다.
- 공유 전체 테이블 화면 `__tables__`를 구성하고 새 개인 결합 화면 `repository-current` / `전체 도메인 · 최신 코드 · 계층 배치`를 만들었다.
- 두 화면에 19개 테이블과 28개 관계의 같은 배치를 적용했다. native의 도메인별 화면은 공유 테이블 화면을 필터링하므로 새 컬럼 크기와 배치를 함께 반영한다.
- 부모를 위, 자식을 아래로 두는 4단 구조로 배치했다. 동일 단계 안에서는 테이블 순서를 탐색해 관계 교차를 줄였다. 색상은 기존 도메인 색상을 유지했다.
- 화면 카메라는 전체를 볼 수 있도록 0.23배로 설정했다.
- 카드 영역은 약 4,269×3,090 문서 px이며 실제 관계선과 라벨을 포함한 SVG 영역은 5,345×3,267, 비율은 1.64:1이다.

## 검증과 잔여 제약

- 원격 변경 후 native 상태와 개인 상태를 다시 읽어 저장했다. 최종 프로젝트 version 8 / sequence 7 / databaseRevision 1, 개인 version 14.
- 공유/개인 화면의 카드 좌표 및 관계 경로가 일치한다.
- nativeTableCanvasMetrics와 실제 relationGeometry로 검증했으며 수동 경로가 렌더러에서 자동 경로로 대체되지 않는지 확인했다.
- 최소 40px 카드 간격 위반 0, 콘텐츠보다 작은 카드 0, 부모→자식 수직 계층 위반 0, 카드 관통 선분 0.
- 동일 좌표에서 공유하는 선 구간 0px, 20px 미만 간격으로 평행하게 달리는 중첩 구간 0px, 관계 라벨끼리의 충돌 0.
- 점 형태 직교 선분 교차 68건, 다른 관계선이 라벨 영역을 지나는 경우 12건은 남는다. 이를 중첩 제거와 혼동하지 않는다. 픽셀 화면을 직접 검사한 결과가 아니라 현재 제품 렌더링 함수의 좌표 검증이다.
- 모든 교차의 제거를 보장하는 전역 최적화는 아니다. 후보 라우팅과 순서 탐색에서 긴 공선 중첩·가까운 평행선·라벨끼리의 충돌을 우선 제거했다. 라벨 관통은 초기 후보 36건에서 12건으로 줄었으며 그 과정에서 점 교차가 증가했다.
- 중간 `compact-routes.json.before`는 후보용 회전 좌표계 자동 경로 기준이며 이전 원격 화면과의 비교 수치가 아니다. 최종 저장된 경로의 검증 값은 verification.json을 기준으로 한다.

## 산출물과 재현

- [현재 검증 결과](../../artifacts/repository-erd/current/verification.json)
- [실제 제품 SVG 렌더링 미리보기](../../artifacts/repository-erd/current/erd-preview.svg)
- [v2 재가져오기 파일](../../artifacts/repository-erd/current/native-project.json): 최신 공유 문서와 개인 화면을 합치고 versionedProjectTransferSchema로 검증했다.
- `project-state.json`, `personal-state.json`: 적용 후 MCP 재조회 결과.
- `2026-10-07-before.json`, `2026-10-07-personal-before.json`: 변경 전 스냅샷.
- `export-repository-erd.mjs`로 현재 스키마를 current 폴더에 내보내고, `refresh-repository-erd.mjs`, `route-compact-repository-erd.mjs`로 배치·경로 후보를 재현한다. MCP 쓰기는 별도이며 같은 commands를 무조건 다시 적용하면 안 된다.
- `verify-repository-erd-refresh.mjs`로 저장된 원격 스냅샷 검증과 SVG/v2 가져오기 파일 생성을 재현한다.
- 일반 node shim은 integrity 오류가 발생해 번들 Node를 사용했다. pnpm format/format:check도 시도했지만 요구 버전 다운로드의 DNS 제한과 번들 pnpm 버전 불일치로 실행되지 않았다. 동일한 설치 Prettier 3.9.6을 직접 실행해 루트 설정으로 --write . 및 --check .를 수행했고 전체 검사를 통과했다.
- 애플리케이션 제품 코드와 docs/EZERD.txt는 수정하지 않았다.

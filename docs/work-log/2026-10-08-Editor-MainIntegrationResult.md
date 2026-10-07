# MAIN UI 통합 결과

계획: [MAIN UI 통합 계획](../planning/2026-10-08-Editor-MainIntegrationPlan.md)

## 구현

- NativeProjectView/NativeCanvasToolbar: 물리·논리 버튼 제거, 더 보기 메뉴에서 논리 설계 ON/OFF. 기본 OFF, ON은 논리 뷰로 전환하며 OFF는 논리 UI를 숨긴다. 문서 데이터는 변경하지 않는다.
- 신규 NativeLogicalMode provider API를 각 담당자에게 공유했다. API 동결 후 추가 변경하지 않았다.
- 도메인 필터 팝오버의 너비·선택행·스크롤·버튼 배치를 신규 전용 CSS로 보완했다. sidebar/pin 버튼 순서를 교환했다.
- 테이블 소속 도메인 Select에 색상점, 미소속에 중립색 점을 추가했다. sidebar의 새 테이블 섹션은 기본 접힘이다.
- 컬럼 상세의 위/아래 이동 및 편집 닫기 버튼을 제거하고 삭제 버튼을 오른쪽으로 정렬했다. 드래그 정렬은 유지했다.
- 기존 상세 설계 렌더를 Bohr 담당 NativeDesignDetails로 교체했다.
- 구조 생성폼과 테이블 관계 inspector를 논리 provider에 연결했다. 논리 전용 초안을 명시적으로 복구할 때는 모드를 활성화해 복구 대상이 편집 가능하도록 했다.
- 후속 ENUM QA에서 구조 편집기 내부 mount key가 version/sequence마다 바뀌는 원인을 수정했다. actor/project/databaseRevision 및 기존 action/target identity는 유지한다. 첫 생성 ACK 이후에는 같은 ID로 patch_enum을 제출한다.

## 즉시 생성과 저장 안전성

- native-table-creation-preview는 빈 테이블 및 전체 테이블 배치의 정확한 두 명령만 미리보기로 허용한다. 일반 patch, 구조 변경 또는 혼합 명령을 낙관적으로 적용하지 않는다.
- enqueueNativeSave가 immutable intent를 보존한 직후 카드와 sidebar를 표시·선택한다. 후속 patch는 동일 기존 큐에서 생성 뒤에 등록된다.
- 원본 snapshot은 변경하지 않는다. 원본 문서가 반영될 때까지 미리보기를 유지하며, 원본 이름을 빈 값으로 덮어쓰지 않는다. 관련 없는 rerender에서 합성 문서의 참조를 유지한다.
- 명시적인 거절이면 미리보기/선택을 롤백한다. 저장소 실패면 처음부터 표시하지 않는다. ACK 불명은 기존 pending 복구·export blocker를 유지한다. 입력 초안은 기존 속성 편집기의 durable draft 경로를 사용한다.
- Canvas 담당자가 optimisticSourceDocument 조회, 개인 뷰에서 전체 테이블 화면으로 이동, ACK 후 재선택 제거를 연결했다.

## 검증

- MAIN/Canvas 연계 회귀 10개 파일, 130개 테스트 통과.
- 포함: NativeProjectView, blank-selection, domain-select, Toolbar, DraftRecovery, DomainEditor.pending, creation-preview, foreign-key-inspector, inspector-audit, Canvas interaction.
- 새 회귀: 논리 ON/OFF의 논리 전용 테이블 편집/데이터 불변, ACK 지연 시 즉시 생성/선택, 생성→patch 큐 순서, 거절 롤백, 저장소 실패 시 표시 없음, preview 적용 범위 제한과 서버 이름 보존, 버튼 순서 및 도메인 색상점.
- pending 테스트 mock은 실제 제출 commands를 보존하도록 수정했다. 기존 원문 ACK/권한/다중 탭 확인 기대를 유지했다.
- 웹 TypeScript `tsc --noEmit -p apps/web/tsconfig.json` 통과.
- 담당 파일 Prettier 및 `git diff --check` 통과. sandbox의 pnpm 경로 오류 때문에 지정 Node로 로컬 CLI를 직접 실행했다.
- ENUM 후속 변경 후 신규 native-structure-creation-identity 및 복구/pending 3개 파일 33개 테스트가 통과했다. ACK 뒤 문서 반영이 늦어도 생성 ID를 유지하고, actor/project/DB 변경에는 분리되는 것을 확인했다.
- 실제 브라우저 시각 QA 및 실제 HTTP 지연 벤치마크는 실시하지 않았다. 지연/실패 검증은 React hook lifecycle driver와 mock transport 기반이다.
- 별도 QA 담당자의 QA-03 카드 소실 관찰에 대해 오너가 권위 DB version7의 qa_orders 물리 테이블+빈 컬럼 및 qa_race_table 저장을 확인했다. 삭제로 단정하거나 가정으로 수정하지 않았으며, 소스 동결 후 논리 OFF/필터 해제/새로고침 재확인을 요청했다.

## 변경 범위와 이관

- MAIN 구현: NativeProjectView.tsx, NativeCanvasToolbar.tsx, NativeTableRelationInspector.tsx, native-editor-structure.tsx, 신규 native-main-integration.css, native-table-creation-preview.ts. provider는 선행 커밋을 위해 동결했다.
- MAIN 테스트: NativeCanvasToolbar.test.ts, NativeProjectView.blank-selection.test.ts, NativeProjectView.domain-select.test.ts, NativeDomainEditor.pending.test.ts, 신규 native-table-creation-preview.test.ts.
- ENUM 후속 신규 테스트: native-structure-creation-identity.test.ts.
- use-native-autosave.ts 및 신규 quiet-window 테스트 초안, 기존 네 autosave 테스트의 300→750ms 변경은 Feynman에게 이관했다. NativeAdvancedEditor 타이밍은 Bohr, concurrent 폼 타이밍은 Faraday가 조정했다.
- 금지된 다른 담당 제품 파일과 docs/EZERD.txt는 직접 수정하지 않았다. Git add/commit과 전체 포맷은 실행하지 않았다. 공유 작업 트리의 커밋은 오너가 순차 수행한다.

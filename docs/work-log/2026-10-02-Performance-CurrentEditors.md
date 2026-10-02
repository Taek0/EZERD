# 최신 main의 성능 도구 호환 검증

작성일: 2026-10-02
제품 기준: main af943f2, lab 병합621f355.

## 변경

- 최신 제품 소스는 main 그대로이며 별도 제품 최적화는 추가하지 않았다. lab의 측정 코드만 현재 공유 테이블 화면과 Native 모델에 맞췄다.
- v1 기본 fixture는 __tables__ 공유 배치와 계약이 요구하는 소유 도메인 배치를 함께 보존한다. createHistoricalPerformanceFixture는 이전 생성 형태를 보존한다.
- fixtureVersion=2, editorKind, documentSchemaVersion, canvasViewId 및 Native databaseKind를 결과에 추가했다. 비교 스크립트도 이 필드를 확인한다. 이전 schema/배치 결과와 새 결과는 직접 섞어 비교하지 않는다.
- 기존 계산 runner는 __tables__의 관계 준비를 사용한다. 기존 측정 페이지는 performance/index.html이다.
- performance/native.html에 실제 NativeERDCanvas의 PostgreSQL 읽기·팬·줌 화면을 추가했다. Native scene/wheel/type display를 별도 계측한다. userId 없이 editable=false이며 API·DB·개인 draft·저장·협업은 측정 범위에서 제외한다. Native 편집·저장/동기화 및 MySQL/SQLite 측정은 후속이다.

## 검증

- pnpm check 통과:1,562개 테스트 통과, DB 등187개 skip, 전체 타입·포맷·일반 빌드 통과. 기존 큰 청크 경고는 유지된다.
- pnpm perf:build에서 legacy/native 두 진입점과 필수 계측 대상이 포함됨을 확인했다. 측정 전용 fixture/계측 테스트9개도 통과했다.
- pnpm perf:calculate 10, pnpm perf:scale 10 성공. 이는 실행 호환성 smoke이며 정식 새 성능 기준값으로 채택하지 않는다.
- Browser 스킬의 in-app browser1440×900에서 v1 카드10개 표시, 팬 문서 불변·geometry0회, 컬럼 편집과100px 카드 이동을 확인했다.
- Native 카드10개 표시, 팬·Ctrl+wheel 줌 후 문서 불변·카메라 변경·계측 출력을 확인했다. Native pan에서는 nativeCanvasScene2회, relationGeometry20회가 관찰되므로 기존 v1의 geometry0회 기준을 적용하지 않는다. 브라우저 error 로그는 없었다.
- 결과 JSON에는 dirty=true를 유지했다. 개발 중 호환성 확인용 표본이며 성능 개선율을 보고하지 않는다. 파일은 artifacts/performance/2026-10-02-compatibility에 보존했다.
- 원래 원시 결과1,449개를 .cache/main-sync-artifacts-20261002.json의 크기·SHA-256과 대조해 모두 동일함을 확인했다. 새 smoke 결과는 별도 경로다.

## 실행과 남은 범위

lab 경로: C:/Users/nty43/.codex/worktrees/product-performance-pr/ERD, codex/performance-lab.

```powershell
pnpm perf:build
pnpm perf:serve
# http://127.0.0.1:4175/performance/index.html
# http://127.0.0.1:4175/performance/native.html
```

현재 main의 DB migration 파일은 소스에 반영됐지만 이 작업에서는 실제 migration이나 API 서버를 실행하지 않았다. 통합 DB 검증은 수행하지 않았고 기본 D:/ChatGPT/ERD의 main·데이터·환경은 수정하지 않았다. 원격 push도 하지 않는다.

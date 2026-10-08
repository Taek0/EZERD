# 관계 기호와 PK/FK 방향 점검 결과

- [계획](../planning/2026-10-09-Relations-DirectionAuditPlan.md)에 따라 현재 앱 구현을 점검했다. 사용자 프로젝트 DB 조회나 제품 코드 변경은 하지 않았다.

## 방향 판정

- 캔버스에서 PK 컬럼을 시작점으로 선택하고 FK를 받을 테이블을 클릭한다. create_foreign_key의 primaryTableId는 시작 PK 테이블, foreignTableId는 마지막 클릭 테이블이다.
- 생성 모델은 sourceTableId/sourceColumnIds에 자식 FK, targetTableId/targetColumnIds에 부모 PK를 저장한다. 앱의 생성 조작 방향과 저장 필드의 source/target 명칭은 서로 반대다.
- SVG 경로는 저장 source(FK)에서 target(PK)로 만들어진다. markerStart에는 FK 끝점, markerEnd에는 PK 끝점을 적용하므로 기호가 뒤집힌 것은 아니다. auto-start-reverse로 양쪽 테이블을 향하도록 배치한다.
- 자동 생성 관계는 FK 쪽 0..N, PK 쪽 1..1이며 FK 컬럼 nullable=false이다. 기본 1:N 생성 시 방향과 기호는 일치한다.
- 사이드바도 target(PK) → source(FK)로 표시한다. PNG는 동일 nativeRelationEnds와 끝점 경로를 사용한다.

## 확인한 제한

- NativeTableLines는 물리/논리 모드 모두 nativeRelationEnds(relation)를 사용한다. 이 함수는 컬럼 NULL·키 제약을 읽지 않고 logical.sourceCardinality/targetCardinality 및 fallback 값을 읽는다.
- 메모리 fixture로 PK→FK 관계를 생성한 뒤 updateNativeColumn으로 FK nullable=true를 적용했다. FK 변경은 성공하지만 끝점은 계속 FK 0..N / PK 1..1이었다. 물리 관계의 선택적 참조(0..1)를 자동 반영하지 않는다.
- 따라서 일반 생성 방향은 정상이나, 현재 기호가 모든 기존 프로젝트의 물리 제약과 항상 일치한다고 단정할 수 없다. 명시적 끝점 설정 및 제약 변경 후 불일치 가능성은 별도 보완 대상이다.

## 근거 파일

- [생성 조작](../../apps/web/src/features/projects/NativeERDCanvas.tsx)
- [생성 모델](../../packages/model/src/database/editing.ts)
- [끝점 카디널리티](../../apps/web/src/features/projects/native-relation-presentation.ts)
- [SVG 기호](../../apps/web/src/features/projects/NativeTableLines.tsx)
- [사이드바 설명](../../apps/web/src/features/projects/NativeTableRelationInspector.tsx)
- [PNG](../../apps/web/src/features/projects/native-canvas-png.ts)

## 검증

- NativeTableLines, native-presentation, native-foreign-key-inspector, native-canvas-png, NativeERDCanvas.interaction: 5개 파일 78개 테스트 통과.
- database/editing: PostgreSQL/MySQL/SQLite PK 기반 생성 등을 포함한 15개 테스트 통과.
- 합계 6개 파일 93개 테스트 통과. 별도 메모리 fixture에서 NULL 변경 후 끝점 불변을 assertion으로 확인했다.
- 실제 브라우저 시각 검증 및 사용자 프로젝트별 데이터 전수 검사는 수행하지 않았다.

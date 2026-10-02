# v1 DB 타입 UI·native 기능 경계 감사 계획

- 작성일: 2026-10-02
- 범위: read-only 코드/명세/테스트 확인. 제품 코드·서버 정책·v1 REST/MCP 계약은 수정하지 않는다. 결과와 최소 수정 후보를 먼저 main에 알린다. 새 peer chat, git add/commit 및 전체 check/build는 하지 않는다.

## 확인 항목

1. explicit formatVersion1 MySQL/SQLite의 project DB/profile/revision이 기존 Canvas/TableEditor/type/default/enum UI에 전달되는지 확인한다.
2. C3의 native 최종 후보 정책과 v1 호환 저장 정책을 구분하여 실제 서버/UI 경계 차이를 기록한다. 기존 PG 표현·unknown/raw type·원문 수정 보존을 막는 정책 변경은 제안하지 않는다.
3. 타입 picker의 inline/detail/new column 경로 및 array/default/enum/파라미터 UI를 확인한다. native-only 기능은 v1 구조에 억지로 넣지 않고 이미 연결된 NativeUpgradeButton으로 명시 안내할 수 있는 callback/props 범위를 식별한다.
4. working tree의 관련 파일 충돌 여부를 기록하고, 별도 helper·targeted tests와 main root callback 연결로 가능한 작은 수정 범위를 보고한다. 현 단계에서는 구현하지 않는다.

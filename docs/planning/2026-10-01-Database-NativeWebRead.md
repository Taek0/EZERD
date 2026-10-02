# C4 웹의 versioned snapshot과 native 조회 화면

- 시작 `5c815df`, 작업 트리 깨끗함. 실제 웹 조회 경계를 연결한다. UI가 native 문서를 v1 물리 타입으로 투영하거나 v1 runtime/baseline을 발급하지 않게 한다.
- 프로젝트 열기는 versioned snapshot 계약을 읽고 sourceSchemaVersion으로 legacy/native entry를 구분한다. v1은 기존 물리 타입/canvas canonicalization 및 personal merge를 유지하고, v2는 native 문서와 별도 조회 화면을 사용한다. preview unavailable도 원본을 v1로 열지 않는다.
- native 조회 화면에서 프로젝트 DB/profile, 도메인·논리/물리 필터, 테이블/컬럼/키/FK/index/CHECK/ENUM 및 default/generation/옵션을 실제 모델대로 표시한다. 편집/DDL은 준비 중이므로 이 단위는 조회 전용이다. 타입/AST/생성 표시를 공통 model helper로 만들고 서버 카드도 같은 타입 표시를 사용한다.
- App의 갤러리/워크스페이스 이동·권한 상실·알림 이동·로그아웃·stale navigation ticket이 native entry를 함께 다루도록 한다. 기존 v1 draft/durable queue를 보존하고 다른 형식으로 자동 재적용하지 않는다. 새 native read는 v1 저장·이력 작업을 시작하지 않는다.
- 타입/긴 수치/문자열/배열/ENUM/legacy/AST 표시, loader의 버전 분기/개인 상태/문맥/용량 보호, 실제 UI 정적 검증과 격리 브라우저 native fixture 열기·필터/세부 항목·gallery 복귀·v1 회귀를 확인한다. 계획·결과·필수 check·독립 커밋 후 native 편집 후보와 실제 저장 연결을 계속한다.

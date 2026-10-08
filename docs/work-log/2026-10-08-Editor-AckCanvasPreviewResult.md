# QA-03 ACK 캔버스 미리보기 수정 결과

계획: [ACK 이후 캔버스 미리보기 보존](../planning/2026-10-08-Editor-AckCanvasPreviewPlan.md)

## 원인과 수정

서버 reader는 누락된 공유 테이블 배치를 normalizeSharedTableCanvas로 보완한다. 그러나 nativeEntryAfterAck는 ACK의 원본 저장 문서를 화면에 직접 사용했다. sidebar에서 생성되어 원본에 배치가 없는 테이블은 첫 조회에 나타났다가 다음 컬럼 수정 ACK에서 사라졌다. DB 삭제가 아닌 읽기 미리보기 계약 불일치다.

native-ack-entry.ts에서 원본과 화면용 문서를 분리했다.

- snapshot.sourceDocument는 ACK 원본을 그대로 유지한다. 보정된 노드를 저장하지 않는다.
- snapshot.native.document에 서버 reader와 같은 정규화를 적용한다. node ID는 tableId 앞 128자와 TABLES_VIEW_ID를 사용하며 기존 모델 함수의 정렬 및 충돌 suffix 규칙을 그대로 사용한다.
- entry.document는 정규화된 공유 문서에 기존 개인 상태를 reconcile/merge한다.
- 기존 ACK 연속성/DB 문맥 검증, 원본 참조 공유, 오류 검증을 유지한다. GET 재조회 우회는 추가하지 않았다.

## 검증

- 수정 전 sparse 원본 테이블 2개 중 하나의 배치가 없는 fixture에서 컬럼 수정 ACK 이후 캔버스 객체가 `[a,b]`에서 `[b]`로 감소하는 실패를 확인했다.
- 수정 후 두 물리 테이블 표시, 컬럼 이름 반영, 기존 노드 identity 보존, 원본/ACK 불변을 검증했다.
- 개인 뷰·노드·viewport 보존 및 shared preview에 개인 상태가 유출되지 않음을 검증했다.
- 160자 table ID 두 개가 같은 128자 prefix를 가지며 기본 node ID가 이미 사용된 경우 `:1`, `:2` suffix를 확인했다. 반복 ACK에도 노드 배열 참조가 유지되고 원본에는 보정 노드가 추가되지 않는다.
- native-ack-entry, 서버 native-document-reader, native-background-refresh, native-table-creation-preview: 4개 파일 22개 테스트 통과.
- 웹 TypeScript 검사 및 대상 diff --check 통과. 대상 파일만 Prettier 적용했다.
- QA 담당자에게 최신 페이지 재로딩 후 qa_orders 컬럼 이름 저장 ACK에서 카드/목록/입력 연결이 유지되는지 브라우저 재검증을 요청했다. 이 문서 시점에서 브라우저 재검증 결과는 대기 중이다.

## 소유 범위

제품 변경은 native-ack-entry.ts 하나, 회귀는 native-ack-entry.test.ts 하나다. 계획/결과 문서 외 다른 파일은 이번 후속 작업에서 수정하지 않았다. 소스를 다시 동결하며 Git add/commit은 오너가 수행한다.

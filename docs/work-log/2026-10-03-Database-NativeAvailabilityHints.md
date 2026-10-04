# Native DB 옵션 상태 안내 수정 결과

- [계획](../planning/2026-10-03-Database-NativeAvailabilityHints.md). SQLite에서 실제 저장 가능한 STRICT/WITHOUT ROWID를 PG schema/미검증 안내로 표시하던 unconditional table paragraph를 제거했다. 해당 DB의 옵션에 실제 코드가 있을 때만 plain 조건을 표시한다.
- default function과 identity의 고정 미검증 안내를 제거했다. 엔진 자체가 거부한 입력/타입 조건은 해당 진단을 유지하고 제품 검증 부족과 혼동하지 않는다. 실제 enabled/disabled 판정·저장 정책/원문 보존은 변경하지 않았다.
- table options/clock default 세 DB 및 identity markup, 기존 format/default 소비59개 통과. 웹 typecheck 통과. 브라우저는 원래 STRICT/WITHOUT ROWID 저장 성공/SQL 출력을 확인했으며 최신 안내는 최종 bundle에서 재확인한다.

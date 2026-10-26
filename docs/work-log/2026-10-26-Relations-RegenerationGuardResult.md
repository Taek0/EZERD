# 관계 재생성 보호 1단계 검증

[계획](../planning/2026-10-26-Relations-PreflightImplementationPlan.md)에 따라 서버 동작을 먼저 확인했다. native-sync-candidate, native-batch-relation-layouts, native-command-editor 세 파일 43테스트 통과. current 기준 관계/테이블/배치 누락, retired entity 재사용 거부, 최신 관계 충돌, 표시용 생성 배치 보완을 포함한다. 기존 보호가 이미 구현되어 서버 코드는 수정하지 않았다. DB 통합 검사 대신 순수 후보/명령 회귀 검사이며 실제 DB·문서 쓰기는 없다.

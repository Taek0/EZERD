# 테이블 표시설정 저장 계약

작성일: 2026-09-15

Table.canvasDisplay에 showNullable/showComment 선택값을 추가했다. 기존 문서는 설정 생략 상태로 호환하며 필드 값이나 DDL 의미를 변경하지 않는다. 표시설정 왕복 저장 및 잘못된 값 거부 테스트를 먼저 실패 확인한 후 구현했다. contracts relational 테스트 4개 통과.

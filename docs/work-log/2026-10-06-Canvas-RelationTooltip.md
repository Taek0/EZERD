# 원본 관계 툴팁의 이름·컬럼·설명 복구

- 감사 R08의 마지막 시맨틱 대조에서 관계 title이 내부 table ID만 표시하는 것을 확인했다.
- 실제 Scene document를 전달해 현재 physical/logical 테이블 이름, PK→FK 대응 컬럼 이름, 논리 관계 이름과 설명을 원본처럼 표시한다. React escape를 유지하며 source/model과 경로는 변경하지 않는다.
- 관계/Scene 회귀 22개 및 web typecheck 통과. 이름·컬럼 표시와 HTML-like 설명 escaping을 확인했다. 브라우저 검증은 사용자 결정에 따라 제외했다.

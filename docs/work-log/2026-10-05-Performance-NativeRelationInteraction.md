# Native 관계선 조작 결과

2026-10-05. 관계선 hit 영역, hover/선택/Enter·Space·Escape, 연결점 및 구간의 pointer drag/방향키 조작을 추가했다. 경로는 미리보기 후 명시 저장하며 자동 경로 복원을 제공한다. NativeCanvasInputForm을 재사용하고 shared/personal 저장을 분리했다. 개인 version과 공유 expected version/sequence/DB revision을 확인한다. 초안 key의 복구 경로를 추가하고 여러 canvas form의 export blocker를 draft별로 분리했다.

관계선/FK 원본 보존, 범위가 다른 route 거부, 공유 명령의 개인 경로 유입 거부, anchor 갱신, 복구와 기존 private/recovered form 회귀 5파일113테스트 통과. 타입 검증 통과. 브라우저 drag/키보드/실제 저장 콜백 연결과 최종 성능은 통합 단계에서 확인한다. 사용자 DB/API에 변경을 보내지 않았다.

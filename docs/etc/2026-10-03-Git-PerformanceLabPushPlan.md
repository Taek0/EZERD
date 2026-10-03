# 성능 lab 원격 푸시 계획

2026-10-03. 사용자의 요청에 따라 clean codex/performance-lab(c28fe4c)의 커밋과 이번 Git 작업 기록을 origin의 동일 이름 브랜치에 일반 push한다. upstream은 origin/codex/performance-lab으로 지정한다. main과 원시 측정 결과(Git 제외)는 푸시 대상이 아니다. 원격 이력이 앞서 있으면 강제 push하지 않고 차이를 확인한다. 완료 후 원격 브랜치 SHA와 로컬 HEAD 일치를 검증한다.

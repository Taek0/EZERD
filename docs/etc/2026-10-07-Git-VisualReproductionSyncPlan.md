# 시각적 드래그 오류 재현용 main 동기화 계획

- 실제 localhost:3001의 정적 asset 이름이 기본 checkout dist/index.html과 일치한다. 해당 checkout HEAD는 215732f다.
- 동일 코드 재현을 위해 성능 lab에 origin/main 215732f를 병합하고 성능 fixture를 다시 빌드한다.
- 기본 checkout/3001 서버/실제 사용자 데이터는 변경하지 않는다.

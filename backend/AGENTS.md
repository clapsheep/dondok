# Backend 작업 규칙

- `./gradlew test`와 `./gradlew bootJar`를 완료 전에 실행한다.
- feature-first 경계를 유지하고 Controller에서 JPA entity를 직접 반환하지 않는다.
- Flyway가 유일한 DDL 원본이며 `ddl-auto=validate`를 유지한다.
- 인증·원장·동시성 변경은 PostgreSQL integration test를 포함한다.
- secret과 실제 이메일·거래 데이터는 로그에 남기지 않는다.

# ARM64 CI와 배포 파이프라인

2026-10-07 사용자 승인. 운영은 Apple Silicon M4 Mac mini이며 앱 이미지의 플랫폼은 `linux/arm64`다. 실제 호스트 주소·경로·계정·private 저장소 식별자는 비공개 설정에만 둔다.

## 검사 경계

PR은 기존 필수 check 이름을 유지하며 build, unit, PostgreSQL integration, OpenAPI, secret 검사와 핵심 Chromium E2E를 실행한다. 핵심 E2E는 `@pr` 태그로 명시한다. 변경된 기능의 spec은 추가 실행하며 공통 UI·인증·배포 기반 변경은 전체 E2E로 확장한다. main은 항상 전체 프로젝트·시나리오를 검사한다. main 실패는 배포를 차단한다. 짧은 unit/integration 검사는 병합 후 revision에서도 반복한다.

GitHub-hosted ARM64 환경에서 JAR와 dist를 한 번 만들고 runtime Dockerfile로 이미지를 포장한다. 모든 E2E job은 같은 workflow run의 이미지 artifact를 받아 `--no-build`로 시작한다. 성공한 main push run만 그 이미지 자체를 GHCR에 올리고 release manifest를 만든다. PR과 benchmark는 게시 권한이 없다. 캐시는 가속 수단이며 검증 증거로 사용하지 않는다.

## 병렬화와 측정 기준

초기 후보는 ARM64 실행 환경 2개 × 환경당 워커 2개다. 환경마다 독립 Compose DB·앱·메일함을 사용한다. 파일 내부는 순차 실행하고 긴 파일의 편중은 보고서로 확인한다. 워커 수 2는 아직 측정으로 확정한 최적값이 아니다.

- 표준 공개 Linux ARM runner: CPU 4개, RAM 16GB. 앱·DB·OS에 CPU 2개 분량을 남기고 브라우저 워커 2개로 시작한다.
- 메모리 조건: `앱·DB 최대 메모리 + 워커 수 × 워커당 최대 메모리 ≤ 전체 RAM × 0.8`.
- 기존 main의 순수 테스트 17.8분, 목표 6분, 가정 효율 0.75에서 `ceil(17.8 / (6 × 2 × 0.75)) = 2` shard. 준비·전송·기동과 긴 파일의 순차 실행 시간은 별도다.
- 수동 benchmark는 같은 이미지·전체 테스트를 워커 1/2/3 각각 3회 실행한다. 매 실행은 새 VM·DB를 사용하고 retry를 끈다. 실패·메모리 부족을 재시도로 숨기지 않는다.
- 2개는 1개 대비 중앙값 25% 이상 단축, 3개는 2개 대비 추가 15% 이상 단축할 때 검토한다. 메모리 80% 이내, swap 입출력 없음, 새 충돌·타임아웃 없음이 선행 조건이다.
- 워커 비교 후 실제 2-shard 실행의 가장 늦은 job과 전체 wall time도 확인한다. 로컬 M4 측정은 GitHub VM의 최적 워커 수 근거로 대신 쓰지 않는다.
- QC blob/trace/screenshot/console/network/seed/request ID는 실행·shard별로 분리해 보존한다. 합산 report가 성공해도 개별 shard 실패를 성공으로 바꾸지 않는다.

## 이미지와 배포 계약

release manifest는 schema version, source repository, 전체 commit SHA, CI run ID/attempt, `linux/arm64`, backend/frontend의 `ghcr.io/...@sha256:...` 참조를 기록한다. artifact 이름은 attempt별로 구분한다. private 배포 workflow는 현재 main SHA의 성공한 `CI` push run과 manifest를 대조한 뒤에만 배포한다. 다른 branch/PR/benchmark의 artifact는 허용하지 않는다.

서버는 digest로 이미지를 pull하고 플랫폼과 OCI revision label을 검사한다. CI에서 검사한 이미지를 다시 build하지 않는다. 기존 백업·격리 복원 drill·migration·Compose readiness·외부 HTTPS 검증은 유지한다. 직전 실행 이미지 참조를 보존해 앱 rollback에 사용하며 DB down migration은 하지 않는다.

기존 private workflow는 배포 스크립트에 GitHub API/artifact 읽기용 `GH_TOKEN`을 전달해야 한다. GHCR package가 private이면 호스트 credential store에 해당 package의 read 권한으로 미리 로그인한다. secret은 public workflow, 이미지, artifact, 문서에 넣지 않는다. 기존 `CI` 성공 조회는 유지하고 manifest가 없는 과거 run은 배포 후보로 사용하지 않는다. 첫 전환은 새로운 CI run과 manifest가 성공한 뒤 진행한다.

## 활성화와 검증 기록

설정 변경과 원격 활성화는 구분한다. merge/push 전에는 새 workflow가 운영에서 실행된 것으로 표현하지 않는다. 워커 벤치마크와 GHCR 게시·다운로드는 원격 workflow에서 확인한다. 운영 배포는 사용자의 배포 요청 또는 기존 예약 정책으로만 실행한다.

참고: [GitHub runner 사양](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Playwright sharding](https://playwright.dev/docs/test-sharding).

원격 실행은 새 workflow가 포함된 branch에서 `workflow_dispatch`의 `benchmark=true`로 워커 비교를 수행한다. 이 경로는 이미지 게시와 운영 배포를 하지 않는다. 실행 단위 artifact를 attempt별로 묶으므로 재검증은 **Re-run all jobs**를 사용한다. 일부 job만 재실행해서 이전 attempt의 산출물과 섞지 않는다.

private 배포 job의 process 환경에 `GH_TOKEN`을 전달한다. public artifact 읽기에 사용할 자격 증명을 workflow secret 또는 기존 호스트 인증으로 준비하고, GHCR private package에는 해당 배포 주체의 read 권한을 부여한다. 공개 저장소의 PR에는 이 credential을 전달하지 않는다. 최초 게시 후 package 접근 검증을 마치기 전에는 운영 전환 완료로 표시하지 않는다.

## 2026-10-07 로컬 검증

동일 checkout에서 진행 중인 다른 기능 수정과 섞이지 않도록 HEAD의 기능 코드에 이번 CI 설정·테스트 helper 변경만 적용한 사본을 사용했다. 테스트 앱은 Linux ARM64 이미지, 브라우저는 로컬 macOS Playwright다. GitHub Ubuntu ARM 성능 측정으로 간주하지 않는다.

- 백엔드 116개, 프론트엔드 95개 테스트 통과. frontend lint/build, E2E config/helper TypeScript 검사 통과.
- runtime 이미지 생성 → archive 저장/재로딩 → `--no-build` 기동·readiness·production Nginx proxy/rate-limit 검사 통과.
- 핵심 Chromium 9개: 워커 2개, retry 0, 모두 통과(22.3초).
- 독립 Compose 두 환경 × 워커 2개: shard 1은 76개 통과/4개 기존 skip(약 5.5분), shard 2는 79개 통과(약 3.3분). 전체 목록 159개와 합집합 일치, 중복/누락/실패/재시도 없음, blob report 병합 통과. 파일 단위 배분의 시간 편중이 남아 있어 원격 benchmark에서 가장 늦은 shard 시간을 함께 확인한다.
- release identity·잘못된 이미지 거부·기동 실패 rollback·benchmark 결과 검증 11개 및 변경 영향 selector 4개 통과. actionlint, Compose 계약, 하네스/secret 검사 통과. Linux 컨테이너에서 resource 측정 스크립트 실행 확인.
- 원격 benchmark 1/2/3 × 3회, GHCR 최초 게시·권한·digest pull, private workflow 연결과 실제 운영 전환은 아직 실행하지 않았다. 이 변경의 commit/push/배포는 별도 실행 단계다.

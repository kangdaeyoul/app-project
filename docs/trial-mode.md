# 운영 체험 모드

`로그인 없이 체험하기`는 Supabase 인증이나 개발용 `/auth/demo`와 별개의 서비스 기능입니다. 운영의 `DEMO_LOGIN_ENABLED=false`를 유지합니다. Secret/service-role key, Supabase 익명 가입, 실제 회사의 테스트 계정을 사용하지 않습니다.

## 사용 흐름

로그인 화면 → 체험 안내 → 관리자/사내직원/작업진행자 선택 → 그냥 체험하기 또는 튜토리얼과 함께 체험하기. Kakao/Naver/Apple은 준비 중 표시만 제공합니다.

각 방문자에게 서버가 임의 생성한 `trial_…` 회사와 전용 예시 저장소를 제공합니다. 관리자 체험은 견적·현장·일정·작업진행자·사진·자재·정산·완료보고서·A/S 기능을 이용할 수 있습니다. 직원·작업진행자 체험은 실제 앱과 같은 역할별 권한 제한을 받습니다. 실제 계정/사용자 승인 관리 기능은 체험에서 차단합니다.

상단 체험 관리:

- 예시 데이터 초기화: 현재 체험 회사 전체를 폐기하고 빈 체험 회사로 교체합니다. 체험 중 입력·업로드한 자료도 삭제합니다.
- 예시 데이터 다시 생성: 현재 체험 회사 전체를 폐기하고 새 예시 회사로 교체합니다.
- 튜토리얼 다시보기: 기존 역할별 실습 튜토리얼을 첫 단계부터 시작합니다.
- 로그아웃: 체험 세션과 해당 체험 회사의 자료를 폐기합니다.

실제 로그인으로 전환할 때도 체험 세션을 폐기합니다. 체험 자료의 가입 계정 이전/승격/병합 API는 없습니다. 실제 개인정보를 체험에 입력하지 마세요.

## 서버 및 RLS 경계

- 서버 전용 256비트 난수 세션, 해시로만 서버 저장, HttpOnly/SameSite=Lax 쿠키. 운영은 Secure입니다.
- 회사 ID/역할은 서버 세션에서만 결정합니다. 클라이언트가 회사 ID를 지정하거나 다른 회사 소유권을 요청하면 거부합니다.
- Supabase 인증 정보가 있으면 항상 실제 인증을 우선 검증하며 체험 권한으로 우회하지 않습니다. 실제 로그인 중에는 체험 시작/초기화를 거부합니다.
- 실제 Supabase membership의 `company_id`가 `trial_`로 시작하면 서버가 거부합니다. CompanyContext도 서버가 발급한 trial identity와 등록된 체험 회사의 조합만 허용합니다.
- 체험 자재는 MATERIAL_STORAGE 설정과 무관하게 메모리 저장소를 사용합니다. 실제 SQLite/PostgreSQL 트랜잭션을 실행하지 않습니다.
- 그 밖의 회사별 업무·사진·파일·A/S·알림·튜토리얼 저장소도 체험 회사별로 분리합니다. 실제 업무 감사 저장소에는 체험 이벤트를 추가하지 않습니다.
- Supabase에는 체험 사용자/membership/업무 자료를 생성하지 않으므로 체험 쿠키로 Supabase RLS에 접근할 수 없습니다. 추가 DB 제약조건으로 실제 사용자의 체험 회사 배정도 막습니다.

## Supabase SQL Editor에서 운영자가 직접 적용할 추가 SQL

기존 `002-supabase-auth.sql` 설치 후 [003-trial-isolation.sql](../apps/api/migrations/003-trial-isolation.sql)을 실행합니다. 이 작업에서 실제 Supabase에 SQL을 자동 실행하지 않습니다. 기존 승인 행에 예약된 `trial_` 회사가 있으면 제약조건 설치가 실패하므로 해당 배정을 먼저 확인해야 합니다. 기존 테이블/행을 삭제하지 마세요.

```sql
begin;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_memberships'::regclass
      and conname = 'app_memberships_no_trial_company'
  ) then
    alter table public.app_memberships
      add constraint app_memberships_no_trial_company
      check (company_id is null or company_id !~ '^trial_');
  end if;
end;
$$;
commit;
```

확인용 조회:

```sql
select conname, pg_get_constraintdef(oid), convalidated
from pg_constraint
where conrelid = 'public.app_memberships'::regclass
  and conname = 'app_memberships_no_trial_company';
```

## 운영 범위와 제한

체험 유효기간은 2시간이며 세션 쿠키를 보존해도 서버가 만료를 검사합니다. 만료/종료/초기화 시 회사별 메모리 저장소를 정리합니다. 주기적인 만료 정리도 수행합니다. API 재시작/재배포 시 체험은 종료되며, 실제 Supabase 세션과 승인은 영향을 받지 않습니다.

현재는 단일 API 프로세스용 임시 체험 저장소입니다. 여러 인스턴스로 확장할 때는 별도 체험 저장소와 세션 공유 설계가 필요합니다. 서버당 최대 50개 활성 체험, 세션당 최대 3,000회 요청, 요청당 최대 2MB 및 세션 전체 입력·업로드 최대 4MB, 관측 IP당 15분에 최대 12회 시작을 허용합니다. Next/Render 프록시에서 같은 IP로 집계될 수 있으므로 운영 트래픽에 맞춘 신뢰 가능한 프록시/IP 설정 및 외부 속도 제한을 검토해야 합니다.

광고는 이번 구현에 포함하지 않습니다. 실제 Supabase/Google 로그인 검증 및 운영 SQL 실행은 별도로 수행합니다.

## 검증 기록

- 빌드 및 타입 검사 통과, API 전체 테스트 98개 통과.
- PC 관리자 / iPhone 크기 직원 / Android 크기 작업진행자: 실제 Chromium에서 역할 선택, 세션 유지, 초기화/재생성, 튜토리얼 재시작, 로그아웃 검증. Supabase 공급자는 로컬 모의 서버입니다.
- 체험별 데이터 수정 격리, 실제 회사 조회/회사 ID 위조 차단, 실제 로그인 시 pending 유지 및 체험 자료 이전 금지, PDF/Excel 출력, 체험 만료 검증.
- 추가 DB 제약조건은 임시 PGlite DB에서 적용·재적용·거부 동작을 검증합니다. 운영 Supabase SQL 실행 및 실제 Google 로그인 성공을 의미하지 않습니다.

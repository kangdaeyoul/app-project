"use client";
import { useEffect, useState } from "react";
import { TutorialScreen } from "@jongro/shared";
import { authApi, useAuth } from "./auth-provider";
const STEPS: [string, string, TutorialScreen, string][] = [
  [
    "company",
    "회사정보 등록",
    "company",
    "견적서와 완료보고서에 사용할 회사명·대표자·사업자번호·주소·전화를 입력합니다.",
  ],
  [
    "assets",
    "로고/직인 등록",
    "company",
    "고객 제출 문서에 사용할 이미지를 등록합니다. 사용하지 않는 경우 생략을 확인할 수 있습니다.",
  ],
  [
    "users",
    "관리자 본인 및 사용자 확인",
    "users",
    "내 정보에서 연락처를 확인하고 직원의 역할과 접근 범위를 지정합니다.",
  ],
  [
    "workers",
    "작업진행자 등록",
    "workers",
    "현장에 배정할 작업진행자와 연락처를 등록합니다.",
  ],
  [
    "customers",
    "거래처 등록",
    "quotes",
    "견적 화면의 거래처 관리에서 고객·업체 정보를 등록합니다.",
  ],
  [
    "materials",
    "자재 기본정보 확인",
    "materials",
    "자재와 단가를 확인하거나 Excel로 가져옵니다. 미등록 단가는 임의로 채우지 않습니다.",
  ],
  [
    "quote",
    "견적 기본설정 확인",
    "quotes",
    "견적의 자동단가·출력·회사정보 설정을 검토합니다.",
  ],
  [
    "sites",
    "첫 현장 등록",
    "sites",
    "현장 등록 후 일정과 대표·참여 작업진행자를 배정하면 업무를 시작할 수 있습니다.",
  ],
  ["schedule", "첫 일정 등록", "schedule", "현장을 선택하고 대표·참여 작업진행자와 날짜·시간을 배정합니다. 관리자는 전체 일정, 직원은 허용된 현장, 작업진행자는 본인 일정과 작업지시로 확인합니다."],
];
interface Status {
  companyId: string;
  userId: string;
  checks: Record<string, boolean>;
  completed: number;
  total: number;
  review: Record<string, boolean>;
}
export default function InitialSetup({
  navigate,
  expanded = false,
}: {
  navigate: (s: TutorialScreen) => void;
  expanded?: boolean;
}) {
  const { user } = useAuth(),
    [data, setData] = useState<Status | null>(null),
    [open, setOpen] = useState(expanded),
    [intro, setIntro] = useState(false),
    [error, setError] = useState("");
  const cacheKey = `setup-intro:${user?.companyId}:${user?.id}`;
  async function load() {
    try {
      const v = await authApi<Status>("/initial-setup");
      setData(v);
      if (
        !expanded &&
        ((!v.review.introSeen && !localStorage.getItem(cacheKey)) ||
          sessionStorage.getItem("setup-replay"))
      ) {
        setIntro(true);
        sessionStorage.removeItem("setup-replay");
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (user?.role !== "admin") return;
    load();
    const refresh = () => load();
    window.addEventListener("app-saved", refresh);
    return () => window.removeEventListener("app-saved", refresh);
  }, [user?.id, user?.companyId]);
  useEffect(() => {
    const show = () => {
      setOpen(true);
      setIntro(false);
      load();
    };
    window.addEventListener("show-initial-setup", show);
    return () => window.removeEventListener("show-initial-setup", show);
  }, []);
  async function review(value: Record<string, boolean>) {
    try {
      setData(
        await authApi<Status>("/initial-setup", {
          method: "PUT",
          body: JSON.stringify(value),
        }),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function closeIntro(start: boolean) {
    localStorage.setItem(cacheKey, "seen");
    setIntro(false);
    setOpen(start);
    await review({ introSeen: true });
  }
  if (user?.role !== "admin") return null;
  if (!data)
    return error ? (
      <p role="alert">
        초기설정을 불러오지 못했습니다: {error}
        <button onClick={load}>다시 시도</button>
      </p>
    ) : null;
  if (data.completed === data.total && !open && !intro) return null;
  return (
    <section className="initial-setup" aria-label="관리자 초기설정 가이드">
      <div className="setup-heading">
        <strong>
          초기 설정 {data.completed}/{data.total} 완료
        </strong>
        <button onClick={() => setOpen(!open)}>
          {open ? "접기" : "남은 설정 확인"}
        </button>
      </div>
      <progress
        aria-label="초기설정 진행률"
        value={data.completed}
        max={data.total}
      />
      {user.isDemo && (
        <p className="setup-demo-note">
          {user.authSource === "trial" ? "이 세션 전용 회사에 예시 자료가 등록되어 있습니다. 자유롭게 수정해 보세요. 상단 체험 관리에서 전체 자료를 초기화·재생성할 수 있으며 실제 회사에는 영향을 주지 않습니다. 사용자 승인 관리는 실제 가입 후 이용합니다." : "체험판에서는 샘플로 기능을 확인할 수 있습니다. 도움말의 별도 튜토리얼 예시에서 수정·삭제·재생성을 연습하세요."}
        </p>
      )}
      {intro && (
        <div className="setup-intro">
          <h2>처음 설정하기</h2>
          <p>
            견적부터 현장작업, 사진, 정산, 완료보고서까지 한 곳에서 관리합니다.
          </p>
          <ol>
            <li>회사설정 · 거래처: 문서와 고객의 기본정보를 준비합니다.</li>
            <li>견적 · 현장: 공사내용과 계약정보를 연결합니다.</li>
            <li>일정 · 작업진행자: 누가 언제 작업할지 배정합니다.</li>
            <li>
              작업기록 · 사진/자재 · 완료보고서 · 정산: 결과와 비용을
              정리합니다.
            </li>
          </ol>
          <div className="tutorial-actions">
            <button onClick={() => closeIntro(false)}>나중에 하기</button>
            <button className="primary" onClick={() => closeIntro(true)}>
              지금 설정하기
            </button>
          </div>
        </div>
      )}
      {open && (
        <>
          <p>
            앱 사용을 시작하기 전에 아래 항목을 순서대로 확인해 주세요. 설정을
            마치지 않아도 앱을 둘러볼 수 있습니다.
          </p>
          <ol className="setup-list">
            {STEPS.map(([key, title, screen, why]) => (
              <li key={key}>
                <div>
                  <strong>
                    {data.checks[key] ? "✓" : "○"} {title}
                  </strong>
                  <span>{data.checks[key] ? "완료" : "미완료"}</span>
                </div>
                <p>{why}</p>
                <button disabled={user.authSource === "trial" && key === "users"} onClick={() => navigate(screen)}>
                  {data.checks[key] ? "확인하기" : "설정하기"}
                </button>
                {["users", "quote"].includes(key) && (
                  <button onClick={() => review({ [key]: !data.checks[key] })}>
                    {data.checks[key] ? "확인 취소" : "검토 완료"}
                  </button>
                )}
                {key === "assets" && (
                  <button
                    onClick={() =>
                      review({ assetsOptional: !data.review.assetsOptional })
                    }
                  >
                    {data.review.assetsOptional
                      ? "이미지 생략 취소"
                      : "로고/직인 없이 사용"}
                  </button>
                )}
              </li>
            ))}
          </ol>
          <p>다음 단계: 현장 → 일정 → 작업진행자 배정 → 실제 업무 시작</p>
          <button onClick={load}>진행상태 새로고침</button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

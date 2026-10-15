"use client";
import { useEffect, useRef, useState } from "react";
const BACK =
  /^(←\s*)?(목록|목록으로|현장 목록|견적 목록|작업 목록|A\/S 목록|뒤로|뒤로가기|이전 화면|취소)$/;
export default function AppNavigation() {
  const [pending, setPending] = useState<(() => void) | null>(null),
    [canBack, setCanBack] = useState(false);
  const dirty = useRef(false),
    allow = useRef(false),
    back = useRef<() => void>(() => {}),
    requestBack = useRef<() => void>(() => {});
  useEffect(() => {
    const parent = () =>
      document.querySelector(".mobile-main,main[data-onboarding-screen]");
    const candidate = () =>
      Array.from(
        parent()?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find(
        (b) =>
          !b.closest(".app-back,.tutorial-coach,.tutorial-help") &&
          BACK.test((b.textContent ?? "").trim()),
      );
    const run = (fn: () => void) => {
      if (dirty.current) {
        setPending(() => () => {
          dirty.current = false;
          allow.current = true;
          document.body.dataset.leaveApproved = "true";
          fn();
          queueMicrotask(() => {
            allow.current = false;
            delete document.body.dataset.leaveApproved;
          });
        });
      } else fn();
    };
    back.current = () =>
      run(() => {
        const b = candidate();
        if (b) b.click();
        else window.dispatchEvent(new Event("app-back"));
      });
    let marked = false;
    requestBack.current = () => {
      if (marked) history.back();
      else back.current();
    };
    const observe = () => {
      const mobile = document.querySelector(".mobile-main h1")?.textContent;
      const visible =
        !!candidate() || !!(mobile && !["홈", "오늘 일정"].includes(mobile));
      setCanBack(visible);
      if (visible && !marked) {
        history.pushState({ ...history.state, appBack: true }, "");
        marked = true;
      } else if (!visible) marked = false;
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, { childList: true, subtree: true });
    observe();
    const input = (event: Event) => {
      const el = event.target as HTMLElement;
      if (
        el.closest("form,.quote-mobile-compose,.quote-form,.mobile-work") &&
        !el.closest(".tutorial-examples,.tutorial-help,.login-page") &&
        !/검색|필터/.test(el.getAttribute("aria-label") ?? "")
      )
        dirty.current = true;
    };
    const click = (event: MouseEvent) => {
      const b = (event.target as HTMLElement).closest<HTMLElement>("button,a");
      if (
        !b ||
        allow.current ||
        !dirty.current ||
        b.closest(".tutorial-help,.tutorial-coach,.app-back,.leave-dialog")
      )
        return;
      const text = b.textContent?.trim() ?? "";
      if (
        (BACK.test(text) || text === "로그아웃") ||
        b.closest("nav,.mobile-bottom-nav,.more-grid") ||
        b.matches("[data-app-navigate]")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        run(() => b.click());
      }
    };
    const saved = () => {
      dirty.current = false;
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const pop = () => {
      if (!marked) return;
      marked = false;
      if (dirty.current) {
        history.pushState({ ...history.state, appBack: true }, "");
        marked = true;
      }
      back.current();
    };
    let start: { x: number; y: number; time: number; ignore: boolean } | null =
      null;
    const touchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length !== 1 || t.clientX > 20) {
        start = null;
        return;
      }
      const el = e.target as HTMLElement;
      let ignore = !!el.closest(
        "input,textarea,select,[data-swipe-ignore],.worker-month-calendar,table,.photo-preview,.pdf-preview",
      );
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        if (
          n.scrollWidth > n.clientWidth + 2 &&
          ["auto", "scroll"].includes(getComputedStyle(n).overflowX)
        )
          ignore = true;
      }
      start = { x: t.clientX, y: t.clientY, time: Date.now(), ignore };
    };
    const nativeSafari = () =>
      /iP(ad|hone|od)/.test(navigator.userAgent) &&
      !(
        (navigator as Navigator & { standalone?: boolean }).standalone ||
        matchMedia("(display-mode: standalone)").matches
      );
    const move = (e: TouchEvent) => {
      if (!start || start.ignore || nativeSafari()) return;
      const t = e.touches[0];
      if (
        t &&
        t.clientX - start.x > 25 &&
        Math.abs(t.clientY - start.y) < 30 &&
        marked &&
        e.cancelable
      )
        e.preventDefault();
    };
    const end = (e: TouchEvent) => {
      if (!start || start.ignore || nativeSafari()) {
        start = null;
        return;
      }
      const t = e.changedTouches[0];
      if (
        t &&
        marked &&
        t.clientX - start.x >= 80 &&
        Math.abs(t.clientY - start.y) <= 35 &&
        Date.now() - start.time < 800
      )
        requestBack.current();
      start = null;
    };
    document.addEventListener("input", input, true);
    document.addEventListener("change", input, true);
    document.addEventListener("click", click, true);
    window.addEventListener("app-saved", saved);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop);
    document.addEventListener("touchstart", touchStart, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("input", input, true);
      document.removeEventListener("change", input, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("app-saved", saved);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", pop);
      document.removeEventListener("touchstart", touchStart);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
    };
  }, []);
  return (
    <>
      {canBack && (
        <div className="app-back">
          <button onClick={() => requestBack.current()}>← 이전</button>
        </div>
      )}
      {pending && (
        <div className="tutorial-help-backdrop leave-dialog">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="저장 전 나가기 확인"
            className="tutorial-help"
          >
            <p>저장하지 않은 변경사항이 있습니다. 이 화면을 나가시겠습니까?</p>
            <div className="tutorial-actions">
              <button autoFocus onClick={() => setPending(null)}>
                계속 작성
              </button>
              <button
                onClick={() => {
                  const fn = pending;
                  setPending(null);
                  fn();
                }}
              >
                나가기
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

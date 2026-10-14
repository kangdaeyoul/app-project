"use client";
import { useEffect, useState } from "react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = matchMedia("(max-width: 760px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
export default function PwaSupport() {
  const [online, setOnline] = useState(true),
    [dismissed, setDismissed] = useState(false),
    [guide, setGuide] = useState(false),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [standalone, setStandalone] = useState(false),
    [ios, setIos] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setOnline(navigator.onLine);
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    setStandalone(
      matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    const status = () => setOnline(navigator.onLine);
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    const showGuide = () => {
      setDismissed(false);
      setGuide(true);
    };
    window.addEventListener("show-pwa-install-guide", showGuide);
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    window.addEventListener("beforeinstallprompt", prompt);
    let registration: ServiceWorkerRegistration | undefined;
    let disposed = false;
    // A newly activated worker must not leave an old login bundle on screen.
    // First installation needs no reload; only a previously controlled page does.
    const wasControlled = !!navigator.serviceWorker?.controller;
    let reloading = false;
    const controllerChanged = () => {
      if (wasControlled && !reloading) {
        if (document.querySelector(".login-page")) { reloading = true; window.location.reload(); }
        else setNotice("새 버전이 준비됐습니다. 입력 내용을 저장한 뒤 새로고침하세요.");
      }
    };
    const update = () => { void registration?.update().catch(() => {}); };
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
      window.addEventListener("focus", update);
      window.addEventListener("online", update);
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((r) => { if (!disposed) { registration = r; update(); } })
        .catch(() => setNotice("홈 화면 설치 준비에 실패했습니다. 새로고침 후 다시 시도하세요."));
    }
    return () => {
      disposed = true;
      navigator.serviceWorker?.removeEventListener("controllerchange", controllerChanged);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      window.removeEventListener("show-pwa-install-guide", showGuide);
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  return (
    <>
      {!online && (
        <div className="connection-banner" role="alert">
          오프라인입니다. 입력한 내용은 아직 서버에 저장되지 않았습니다.
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!standalone && !dismissed && (install || ios || guide) && (
        <div className="pwa-install">
          {install ? (
            <button
              onClick={async () => {
                await install.prompt();
                await install.userChoice;
                setInstall(null);
              }}
            >
              홈 화면에 설치
            </button>
          ) : (
            <span>
              {ios
                ? "iPhone Safari의 공유 버튼 → 홈 화면에 추가"
                : "브라우저 메뉴 → 앱 설치 / 홈 화면에 추가"}
            </span>
          )}
          <button
            aria-label="설치 안내 닫기"
            onClick={() => setDismissed(true)}
          >
            닫기
          </button>
        </div>
      )}
    </>
  );
}

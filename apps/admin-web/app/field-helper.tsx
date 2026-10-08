export type HelperPose =
  "base" | "greeting" | "working" | "completed" | "warning" | "photo" | "quote";
// Brand areas intentionally remain blank. Pose-specific artwork can replace this vector later.
export default function FieldHelper({
  pose = "base",
  title = "오늘의 현장도 차근차근, 안전하게.",
  description = "현장 일정과 작업 기록을 한곳에서 확인하세요.",
}: {
  pose?: HelperPose;
  title?: string;
  description?: string;
}) {
  return (
    <section className="field-greeting" data-pose={pose}>
      <svg
        width="80"
        height="92"
        viewBox="0 0 80 92"
        role="img"
        aria-label="흰 안전모와 남색 작업복을 입은 현장관리 도우미"
      >
        <path d="M12 90V68Q12 55 40 55Q68 55 68 68V90" fill="#29485e" />
        <path d="M29 56L40 67L51 56" fill="#e6edf1" />
        <path d="M27 40V57Q40 69 53 57V40" fill="#e8b68e" />
        <ellipse cx="40" cy="33" rx="21" ry="25" fill="#f0c6a2" />
        <path
          d="M17 24Q17 0 40 0Q63 0 63 24Z"
          fill="#fff"
          stroke="#bccbd5"
          strokeWidth="2"
        />
        <rect
          x="12"
          y="22"
          width="56"
          height="6"
          rx="3"
          fill="#fff"
          stroke="#bccbd5"
        />
        <path d="M40 3V21" stroke="#d6e0e5" strokeWidth="3" />
        <circle cx="32" cy="34" r="2" fill="#263b49" />
        <circle cx="48" cy="34" r="2" fill="#263b49" />
        <path
          d="M33 45Q40 51 47 45"
          fill="none"
          stroke="#9d5742"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x="43"
          y="65"
          width="26"
          height="24"
          rx="2"
          fill="#e5d6b7"
          stroke="#8d7856"
        />
        <rect x="51" y="63" width="10" height="5" rx="1" fill="#748595" />
        <path d="M49 73H63M49 78H63M49 83H59" stroke="#748595" />
        <rect x="20" y="71" width="12" height="6" rx="1" fill="#e6edf1" />
      </svg>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </section>
  );
}

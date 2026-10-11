export type HelperPose =
  | "base"
  | "guide"
  | "check"
  | "greeting"
  | "calendar"
  | "notification"
  | "completed"
  | "inspection"
  | "working"
  | "warning"
  | "photo"
  | "quote";
const positions: Record<HelperPose, number> = {
  base: 0,
  guide: 1,
  check: 2,
  greeting: 3,
  calendar: 4,
  notification: 5,
  completed: 6,
  inspection: 7,
  working: 2,
  warning: 5,
  photo: 1,
  quote: 2,
};
// One shared character atlas, no brand marks. Artwork is independent of UI and copy.
export function HelperCharacter({ pose = "base" }: { pose?: HelperPose }) {
  const cell = positions[pose];
  return (
    <span
      className="helper-character"
      role="img"
      aria-label="흰 안전모와 네이비 작업복을 입은 현장 도우미"
      style={{
        backgroundPosition: `${((cell % 4) * 100) / 3}% ${cell < 4 ? 0 : 100}%`,
      }}
    />
  );
}
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
      <HelperCharacter pose={pose} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </section>
  );
}

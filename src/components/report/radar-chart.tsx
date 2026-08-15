import type { RadarAxis } from "@/lib/report";

/* 시안(47-1889)의 그리드 벡터를 그대로 읽어 낸 값 — 차트 판은 382×264 이고
   오각형은 (190.8, 126) 을 중심으로 반지름 86, 위 꼭짓점부터 시계방향이다.
   벡터를 그대로 쓰지 않고 좌표로 옮긴 건 값이 바뀌면 다시 그려야 하기 때문. */
const WIDTH = 382;
const HEIGHT = 264;
const CENTER = { x: 190.8, y: 126 };
const RADIUS = 86;
/** 그리드 오각형 겹 수 */
const RINGS = 5;

/** i 번째 축(위에서 시계방향)의 비율 ratio 지점. */
function point(index: number, ratio: number, count: number) {
  const angle = ((-90 + (360 / count) * index) * Math.PI) / 180;
  const length = RADIUS * ratio;
  return {
    x: CENTER.x + length * Math.cos(angle),
    y: CENTER.y + length * Math.sin(angle),
  };
}

/** 축을 ratio 만큼 이은 닫힌 다각형의 points 속성. */
function polygon(ratio: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const { x, y } = point(index, ratio, count);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

/** 말하기 역량 오각형(시안 47-1889). 축마다 색이 다른 점이 찍힌다. */
export function RadarChart({ axes }: { axes: RadarAxis[] }) {
  const count = axes.length;

  return (
    <div className="relative h-[264px] w-full">
      <svg
        aria-hidden
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="absolute inset-0 size-full"
      >
        {/* 안쪽부터 바깥까지 겹겹이 깔리는 그리드 */}
        {Array.from({ length: RINGS }, (_, ring) => (
          <polygon
            key={ring}
            points={polygon((ring + 1) / RINGS, count)}
            fill="none"
            stroke="#efefef"
          />
        ))}

        {/* 중심에서 각 꼭짓점으로 뻗는 축 */}
        {axes.map((axis, index) => {
          const end = point(index, 1, count);
          return (
            <line
              key={axis.name}
              x1={CENTER.x}
              y1={CENTER.y}
              x2={end.x}
              y2={end.y}
              stroke="#efefef"
            />
          );
        })}

        <polygon
          points={axes
            .map((axis, index) => {
              const { x, y } = point(index, axis.value / 100, count);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="#45a9d3"
          fillOpacity={0.3}
          stroke="#6fbcdd"
          strokeWidth={2}
        />

        {axes.map((axis, index) => {
          const { x, y } = point(index, axis.value / 100, count);
          return <circle key={axis.name} cx={x} cy={y} r={5} fill={axis.color} />;
        })}
      </svg>

      {/* 이름표는 SVG 밖에 둔다 — 본문과 같은 폰트로 렌더되도록 */}
      {axes.map((axis) => (
        <span
          key={axis.name}
          className="absolute -translate-x-1/2 text-[14px] leading-[1.3] font-extrabold text-[#3d3d3d]"
          style={{ left: axis.label.x, top: axis.label.y }}
        >
          {axis.name}
        </span>
      ))}
    </div>
  );
}

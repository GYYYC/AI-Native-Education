'use client';

/**
 * 六边形雷达图组件
 * 支持大六边形（6门课程平均）和小六边形（单课程6维度）
 */
export default function HexagonRadar({ scores = [], labels = [], size = 220, title = '', color = '#6c5ce7', maxScore = 5 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const n = labels.length || 6;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  // 生成正多边形顶点
  const getPoint = (radius, index) => {
    const angle = startAngle + index * angleStep;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  };

  // 网格线（5层）
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  const gridPaths = gridLevels.map(level => {
    const points = Array.from({ length: n }, (_, i) => getPoint(r * level, i));
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
  });

  // 坐标轴线
  const axisLines = Array.from({ length: n }, (_, i) => {
    const p = getPoint(r, i);
    return `M${cx},${cy} L${p.x},${p.y}`;
  });

  // 数据多边形
  const safeScores = Array.from({ length: n }, (_, i) => Math.max(0, Math.min(maxScore, scores[i] || 0)));
  const dataPoints = safeScores.map((s, i) => getPoint(r * (s / maxScore), i));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  // 标签位置（稍微外移）
  const labelPoints = Array.from({ length: n }, (_, i) => {
    const p = getPoint(r * 1.22, i);
    return p;
  });

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      {title && <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>{title}</div>}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        {/* 背景网格 */}
        {gridPaths.map((d, i) => (
          <path key={`grid-${i}`} d={d} fill="none" stroke="var(--border)" strokeWidth={0.5} opacity={0.5} />
        ))}

        {/* 坐标轴 */}
        {axisLines.map((d, i) => (
          <path key={`axis-${i}`} d={d} stroke="var(--border)" strokeWidth={0.5} opacity={0.4} />
        ))}

        {/* 数据区域 */}
        <path d={dataPath} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={2} />

        {/* 数据点 */}
        {dataPoints.map((p, i) => (
          <circle key={`dot-${i}`} cx={p.x} cy={p.y} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
        ))}

        {/* 标签 */}
        {labelPoints.map((p, i) => (
          <text
            key={`label-${i}`}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fill="var(--text-secondary)"
            fontWeight={500}
          >
            {labels[i] || `维度${i + 1}`}
          </text>
        ))}

        {/* 分数显示 */}
        {dataPoints.map((p, i) => (
          <text
            key={`score-${i}`}
            x={p.x}
            y={p.y - 12}
            textAnchor="middle"
            fontSize={10}
            fill={color}
            fontWeight={600}
          >
            {safeScores[i].toFixed(1)}
          </text>
        ))}
      </svg>

      {/* 平均分 */}
      {scores.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          平均分：<span style={{ fontWeight: 700, color }}>{(safeScores.reduce((a, b) => a + b, 0) / n).toFixed(2)}</span> / {maxScore}
        </div>
      )}
    </div>
  );
}

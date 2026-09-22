import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ZAxis,
  Label,
} from "recharts";

// ── Color scheme (Tailwind palette tokens) ──────────────────────────────
const RISK_COLORS = {
  Low: "#22c55e",    // green-500
  Medium: "#f59e0b", // amber-500
  High: "#ef4444",   // red-500
};

// ── Custom pie label showing percentage ─────────────────────────────────
const RADIAN = Math.PI / 180;
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      className="text-xs font-semibold"
      style={{ fontSize: 13, fontWeight: 600 }}
    >
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
}

// ── Custom scatter tooltip ──────────────────────────────────────────────
function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white rounded-lg shadow-md border border-slate-200 px-3 py-2 text-sm">
      <p className="font-semibold text-slate-800">
        Project #{d.project_id ?? "—"}
      </p>
      <p className="text-slate-600">
        PPI: <span className="font-medium">{d.materials_ppi?.toFixed(1)}</span>
      </p>
      <p className="text-slate-600">
        Overrun:{" "}
        <span className="font-medium">
          {d.predicted_overrun_pct?.toFixed(2)}%
        </span>
      </p>
      <p className="text-slate-600">
        Risk:{" "}
        <span
          className="font-medium"
          style={{ color: RISK_COLORS[d.predicted_risk_tier] }}
        >
          {d.predicted_risk_tier}
        </span>
      </p>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────
/**
 * ChartsPanel — two side-by-side analytics cards.
 * @param {{ riskCounts: { Low: number, Medium: number, High: number },
 *           projects: Array<{ materials_ppi: number,
 *                             predicted_overrun_pct: number,
 *                             predicted_risk_tier: string,
 *                             project_id?: number }> }} props
 */
export default function ChartsPanel({ riskCounts, projects }) {
  // ── Pie data ────────────────────────────────────────────────────────
  const pieData = Object.entries(riskCounts ?? {}).map(([name, value]) => ({
    name,
    value,
  }));

  // ── Scatter data, split by risk tier ────────────────────────────────
  const scatterByTier = {};
  (projects ?? []).forEach((p) => {
    const tier = p.predicted_risk_tier ?? "Low";
    if (!scatterByTier[tier]) scatterByTier[tier] = [];
    scatterByTier[tier].push(p);
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ── Left card: Risk Distribution Pie ────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">
          Risk Distribution
        </h3>

        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={120}
              innerRadius={50}
              paddingAngle={3}
              label={PieLabel}
              labelLine={false}
              animationDuration={800}
              animationBegin={100}
            >
              {pieData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={RISK_COLORS[entry.name]}
                  stroke="none"
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [
                `${value.toLocaleString()} projects`,
                name,
              ]}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgb(0 0 0 / .1)",
              }}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={10}
              formatter={(value) => (
                <span className="text-sm text-slate-600">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* ── Right card: Scatter — PPI vs Overrun ────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-1">
          Materials Price Index vs Predicted Overrun
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Demonstrates that materials pricing predicts cost overrun
        </p>

        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 24, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="materials_ppi"
              name="Materials PPI"
              tick={{ fontSize: 12 }}
              stroke="#94a3b8"
            >
              <Label
                value="Materials PPI"
                position="bottom"
                offset={6}
                style={{ fill: "#64748b", fontSize: 13, fontWeight: 500 }}
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="predicted_overrun_pct"
              name="Predicted Overrun %"
              tick={{ fontSize: 12 }}
              stroke="#94a3b8"
            >
              <Label
                value="Predicted Overrun %"
                angle={-90}
                position="insideLeft"
                offset={4}
                style={{ fill: "#64748b", fontSize: 13, fontWeight: 500 }}
              />
            </YAxis>
            <ZAxis range={[28, 28]} />
            <Tooltip content={<ScatterTooltip />} cursor={false} />
            <Legend
              verticalAlign="top"
              iconType="circle"
              iconSize={10}
              formatter={(value) => (
                <span className="text-sm text-slate-600">{value}</span>
              )}
            />
            {["Low", "Medium", "High"].map((tier) => (
              <Scatter
                key={tier}
                name={tier}
                data={scatterByTier[tier] ?? []}
                fill={RISK_COLORS[tier]}
                fillOpacity={0.7}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { useEffect, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';

const BASE = '';

const PAIR_COLORS = ['#ff6b8a', '#5ade9a', '#ffc046', '#9b6bff'];

const D3 = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp));

// ── Metrics derived from server data ──────────────────────────────────────
function formatMetrics(data) {
  if (!data || data.error) return null;

  const az = data.peak_az ?? data.peak_angle_deg ?? 0;
  const el = data.peak_el ?? 0;
  const peakMhz = data.peak_mhz;

  // FIXED — converts phase difference to arrival angle in degrees
  const pairs = (data.pair_info || []).map((p, k) => {
    const dphi = p.dphi || 0;
    // arcsin(Δφ / (2π × d/λ)), d/λ = 0.5 → arcsin(Δφ / π)
    const sinVal = Math.max(-1, Math.min(1, (dphi * Math.PI / 180) / Math.PI));
    const angleDeg = Math.asin(sinVal) * (180 / Math.PI);
    return {
    label: p.label || `Pair ${k + 1}`,
    color: PAIR_COLORS[k % PAIR_COLORS.length],
    dphi,
    angle: parseFloat(angleDeg.toFixed(2)),
  };
})

  return { az, el, pairs, meanAngle: az, stdAngle: 0, peakMhz };
}

// ── Sub-component: polar needle ───────────────────────────────────────────
function PolarNeedle({ title, angleDeg, color, width, height }) {
  const ang = angleDeg ?? 0;

  const trace = {
    type: 'scatterpolar',
    r: [0, 0.95],
    theta: [0, (ang + 90) % 360],
    mode: 'lines+markers',
    line: { color, width: 3.5 },
    marker: { color, size: [5, 13], symbol: ['circle', 'star'] },
    showlegend: false,
    hoverinfo: 'none',
  };

  const bg = {
    type: 'scatterpolar',
    r: [0, 1],
    theta: [0, 360],
    mode: 'lines',
    line: { color: 'rgba(0,0,0,0)', width: 0 },
    fill: 'toself',
    fillcolor: 'rgba(0,0,0,0)',
    hoverinfo: 'none',
    showlegend: false,
  };

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    width,
    height,
    margin: { l: 20, r: 20, t: 52, b: 10 },
    polar: {
      bgcolor: 'transparent',
      angularaxis: {
        tickmode: 'array',
        tickvals: [0, 45, 90, 135, 180, 225, 270, 315],
        ticktext: ['0°', '45°', '90°', '135°', '180°', '225°', '270°', '315°'],
        direction: 'clockwise',
        rotation: 90,
        tickfont: { color: '#7a9aba', size: 9, family: 'monospace' },
        gridcolor: '#1e2e48',
        linecolor: '#1e2e48',
      },
      radialaxis: {
        range: [0, 1],
        showticklabels: true,
        tickmode: 'array',
        tickvals: [0.2, 0.4, 0.6, 0.8, 1.0],
        tickfont: { color: '#4a6080', size: 8, family: 'monospace' },
        gridcolor: '#141c2e',
        linecolor: '#141c2e',
      },
    },
  };

  return (
    <div style={{ position: 'relative', width, height }}>
      <div style={{
        position: 'absolute', top: 5, left: 12,
        fontSize: 10, color, fontFamily: 'monospace', fontWeight: 800,
      }}>
        {title}
      </div>
      <div style={{
        position: 'absolute', top: 12, left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 12, color, fontFamily: 'monospace', fontWeight: 700,
      }}>
        {ang.toFixed(1)}°
      </div>
      <Plot
        data={[trace, bg]}
        layout={layout}
        config={{ staticPlot: true }}
        style={{ width, height }}
      />
    </div>
  );
}

// ── Sub-component: phase bar chart ────────────────────────────────────────
function PhaseBar({ pairs, peakMhz, width, height }) {
  if (!pairs?.length) return null;

  const trace = {
    type: 'bar',
    x: pairs.map(p => p.label),
    y: pairs.map(p => p.dphi),
    marker: {
      color: pairs.map(p => p.color),
      opacity: 0.82,
      line: { color: pairs.map(p => p.color), width: 1.5 },
    },
    text: pairs.map(p => `${p.dphi.toFixed(1)}°`),
    textposition: 'outside',
    textfont: { color: '#c8d8f0', size: 11, family: 'monospace' },
    hovertemplate: '%{x}: %{y:.2f}°<extra></extra>',
  };

  const maxAbs = Math.max(180, ...pairs.map(p => Math.abs(p.dphi) + 20));

  const layout = {
    paper_bgcolor: '#0a0e1a',
    plot_bgcolor: '#080c18',
    margin: { l: 52, r: 16, t: 42, b: 44 },
    width,
    height,
    title: {
      text: peakMhz != null
        ? `Phase at Peak Bin (${Number(peakMhz).toFixed(4)} MHz)`
        : 'Inter-Element Phase Difference (Δφ)',
      font: { color: '#c8d8f0', size: 11, family: 'monospace' },
      x: 0.5,
    },
    xaxis: {
      color: '#5a6a8a',
      gridcolor: '#141c2e',
      tickfont: { color: '#7a9aba', size: 11, family: 'monospace' },
    },
    yaxis: {
      title: { text: 'Phase (°)', font: { color: '#5a6a8a', size: 10 } },
      color: '#3a4a6a',
      gridcolor: '#141c2e',
      tickfont: { color: '#5a7090', size: 10, family: 'monospace' },
      range: [-maxAbs, maxAbs],
      zeroline: true,
      zerolinecolor: '#3a4a6a',
      zerolinewidth: 1.5,
    },
    bargap: 0.35,
  };

  return (
    <Plot
      data={[trace]}
      layout={layout}
      config={{ displayModeBar: false, staticPlot: true }}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

// ── Sub-component: pair table ─────────────────────────────────────────────
function PairTable({ pairs, meanAngle }) {
  const cell = (extra = {}) => ({
    padding: '8px 14px', fontSize: 11, fontFamily: 'monospace',
    color: '#c8d8f0', borderBottom: '1px solid #141c2e', ...extra,
  });
  const head = () => ({
    ...cell(), color: '#00aacc', fontSize: 10,
    fontWeight: 700, letterSpacing: '0.06em',
  });

  return (
    <div style={{
      background: '#0a0e1a', border: '1px solid #141c2e',
      borderRadius: 6, overflow: 'hidden', width: '100%',
    }}>
      <div style={{
        padding: '9px 14px', borderBottom: '1px solid #141c2e',
        fontSize: 12, fontWeight: 700, color: '#c8d8f0',
        fontFamily: 'monospace', textAlign: 'center',
      }}>
        Pair Estimates
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Pair', 'Δφ (deg)', 'AoA (deg)'].map(h => (
              <th key={h} style={head()}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i}>
              <td style={cell()}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: p.color, display: 'inline-block', flexShrink: 0,
                  }} />
                  {p.label}
                </span>
              </td>
              <td style={cell()}>{D3(p.dphi)}°</td>
              <td style={cell()}>{D3(p.angle)}°</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared UI Primitives ──────────────────────────────────────────────────
const Center = ({ children }) => (
  <div style={{
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: 12,
  }}>
    {children}
  </div>
);
const Msg = ({ children, c = '#5a6a8a' }) => (
  <div style={{
    fontSize: 11, color: c, fontFamily: 'monospace',
    letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase',
  }}>
    {children}
  </div>
);
const Btn = ({ children, onClick }) => (
  <button onClick={onClick} style={{
    background: '#1c2e48', color: '#00d4ff',
    border: '1px solid #00d4ff', padding: '6px 14px',
    fontSize: 10, fontFamily: 'monospace', cursor: 'pointer', borderRadius: 4,
  }}>
    {children}
  </button>
);
const Spin = () => (
  <Center>
    <div style={{
      width: 24, height: 24,
      border: '2px solid rgba(0,212,255,0.1)',
      borderTopColor: '#00d4ff',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
  </Center>
);

// ── Main Component ────────────────────────────────────────────────────────
export default function DoaChart({
  activeDatasetId,
  positionMs = 0,
  windowMs = 10,
  dspVersion = 0,
  compareMode = false,
  compareIds = [],
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dims, setDims] = useState({ w: 900, h: 600 });
  const containerRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ w: Math.floor(width - 4), h: Math.floor(height - 4) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const fetchData = useCallback(async () => {
    const hasCompare = compareMode && compareIds.length > 0;
    if (!activeDatasetId && !hasCompare) return;

    setLoading(true);
    try {
      const qs = new URLSearchParams();


      // FIX: backend only accepts 'dataset_ids' (plural, List[str]).
      // Old code sent 'dataset_id' (singular) for the single-file path,
      // which the backend ignored — ids defaulted to [] and the endpoint
      // always returned "requires at least 2 channels".
      // Now we always append to 'dataset_ids' regardless of mode.
      if (hasCompare) {
        compareIds.forEach(id => qs.append('dataset_ids', id));
      } else {
        // Single file: backend will still return "need 2 channels" error,
        // which is the correct behaviour — DoA genuinely needs ≥2 signals.
        qs.append('dataset_ids', activeDatasetId);
      }

      qs.append('position_ms', positionMs);
      qs.append('window_ms', windowMs);

      const res = await fetch(`${BASE}/api/doa?${qs.toString()}`);
      if (res.status === 404) throw new Error('endpoint_missing');

      const d = await res.json();
      if (d.error) {
        setError(d.error);
        setData(null);
      } else {
        setData(d);
        setError(null);
        setRevision(r => r + 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeDatasetId, compareMode, compareIds.join(','), positionMs, windowMs, dspVersion]);

  useEffect(() => {
    fetchData();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchData, 4000);
    return () => clearInterval(pollRef.current);
  }, [fetchData]);

  const derived = formatMetrics(data);
  const noFile = !activeDatasetId && (!compareMode || compareIds.length === 0);
  const missing = error === 'endpoint_missing';
  const hasData = !!data?.angles?.length;

  const W = dims.w;
  const polarH = Math.max(220, Math.floor(dims.h * 0.42));
  const phaseH = Math.max(200, Math.floor(dims.h * 0.36));
  const halfW = Math.floor(W / 2) - 4;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        background: '#0a0e1a', overflow: 'hidden',
      }}
    >
      {/* ── header bar ──────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '8px 12px', borderBottom: '1px solid #141c2e',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: '#5a6a8a', fontFamily: 'monospace' }}>
          DOA ESTIMATOR · MULTI-CHANNEL (PERIODOGRAM)
        </span>
        {derived && (
          <div style={{
            marginLeft: 'auto', display: 'flex',
            gap: 12, fontSize: 11, fontFamily: 'monospace',
          }}>
            <span style={{ color: '#4d9fff' }}>AZ: {D3(derived.az)}°</span>
            <span style={{ color: '#ff6b8a' }}>EL: {D3(derived.el)}°</span>
          </div>
        )}
      </div>

      {/* ── content ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>

        {noFile && (
          <Center>
            <Msg>NO FILES SELECTED</Msg>
            <div style={{ fontSize: 10, color: '#3a5070', fontFamily: 'monospace', textAlign: 'center' }}>
              Enable "Compare Mode" and select ≥ 2 files for DoA estimation.
            </div>
          </Center>
        )}

        {!noFile && missing && (
          <Center>
            <Msg c="#ffc046">DOA ENDPOINT NOT FOUND</Msg>
            <div style={{ fontSize: 10, color: '#3a5070', fontFamily: 'monospace' }}>
              Check that the backend is running and /api/doa is registered.
            </div>
          </Center>
        )}

        {!noFile && error && !missing && (
          <Center>
            <Msg c="#ff4d6d">ERROR</Msg>
            <div style={{
              fontSize: 10, color: '#ff6b6b', fontFamily: 'monospace',
              maxWidth: 400, textAlign: 'center', lineHeight: 1.6,
            }}>
              {error}
            </div>
            <Btn onClick={fetchData}>RETRY</Btn>
          </Center>
        )}

        {loading && !hasData && !error && <Spin />}

        {hasData && derived && (
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Azimuth + Elevation polar needles */}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, height: polarH, background: '#090d1a', border: '1px solid #141c2e', borderRadius: 4, overflow: 'hidden' }}>
                <PolarNeedle
                  title="Azimuth"
                  angleDeg={derived.az}
                  color="#4d9fff"
                  width={halfW}
                  height={polarH}
                />
              </div>
              <div style={{ flex: 1, height: polarH, background: '#090d1a', border: '1px solid #141c2e', borderRadius: 4, overflow: 'hidden' }}>
                <PolarNeedle
                  title="Elevation"
                  angleDeg={derived.el}
                  color="#ff6b8a"
                  width={halfW}
                  height={polarH}
                />
              </div>
            </div>

            {/* Phase bar */}
            <div style={{ height: phaseH, background: '#090d1a', border: '1px solid #141c2e', borderRadius: 4, overflow: 'hidden' }}>
              <PhaseBar
                pairs={derived.pairs}
                peakMhz={derived.peakMhz}
                width={W - 16}
                height={phaseH}
              />
            </div>

            {/* Pair table */}
            <PairTable pairs={derived.pairs} meanAngle={derived.az} />

          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
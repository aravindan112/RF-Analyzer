import { useEffect, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';

const BASE = `http://${window.location.hostname}:8000`;

export default function IQTimeSeriesChart({
  activeDatasetId,
  positionMs = 0,
  windowMs = 10,
  dspVersion = 0,
  compareMode = false,
  compareIds = [],
  fileColors = ['#00d4ff', '#ff6b8a', '#5ade9a', '#ffc046'],
}) {
  const [datasets, setDatasets] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dims, setDims] = useState({ width: 800, height: 500 });
  const containerRef = useRef(null);
  const pollRef = useRef(null);
  const fetchingRef = useRef(false);

  // ── container-size tracking ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ width: Math.floor(width - 2), height: Math.floor(Math.max(height - 48, 280)) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const targetIds = compareMode && compareIds.length > 0
    ? compareIds
    : (activeDatasetId ? [activeDatasetId] : []);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current || targetIds.length === 0) {
      if (targetIds.length === 0) setError('no_file');
      return;
    }
    fetchingRef.current = true;
    setLoading(true);
    try {
      const results = await Promise.all(
        targetIds.map(id => {
          const p = new URLSearchParams({ dataset_id: id, position_ms: positionMs, window_ms: windowMs });
          return fetch(`${BASE}/api/iq_timeseries?${p}`)
            .then(r => r.json())
            .then(json => ({ id, json }))
            .catch(() => ({ id, json: { error: 'fetch failed' } }));
        })
      );
      const next = {};
      results.forEach(({ id, json }) => { if (!json.error) next[id] = json; });
      if (Object.keys(next).length === 0) throw new Error('No data');
      setDatasets(next);
      setRevision(r => r + 1);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); fetchingRef.current = false; }
  }, [targetIds.join(','), positionMs, windowMs, dspVersion]);

  useEffect(() => {
    fetchData();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchData, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchData]);

  // ── Build split I / Q traces ─────────────────────────────────────────────────
  const iTraces = [];
  const qTraces = [];
  const multi = Object.keys(datasets).length > 1;

  Object.entries(datasets).forEach(([id, d], idx) => {
    const globalIdx = compareIds.indexOf(id);
    const colorIdx = globalIdx >= 0 ? globalIdx : idx;
    const iColor = fileColors[colorIdx % fileColors.length];
    const qColor = adjustAlpha(iColor, 0.75);
    const shortId = id.length > 16 ? id.slice(0, 14) + '…' : id;

    iTraces.push({
      x: d.t, y: d.i,
      type: 'scatter', mode: 'lines', xaxis: 'x', yaxis: 'y',
      name: multi ? `I · ${shortId}` : 'I — In-Phase',
      line: { color: iColor, width: 1.4 },
      hovertemplate: '%{x:.3f} ms | I: %{y:.5f}<extra></extra>',
    });

    qTraces.push({
      x: d.t, y: d.q,
      type: 'scatter', mode: 'lines', xaxis: 'x', yaxis: 'y2',
      name: multi ? `Q · ${shortId}` : 'Q — Quadrature',
      line: { color: qColor, width: 1.4, dash: multi ? 'solid' : 'solid' },
      hovertemplate: '%{x:.3f} ms | Q: %{y:.5f}<extra></extra>',
    });
  });

  const allTraces = [...iTraces, ...qTraces];

  // Panel split: I takes top 50 %, Q bottom 50 % with a gap
  const layout = {
    uirevision: 'iqts-split',
    paper_bgcolor: '#0a0e1a',
    plot_bgcolor: '#080c18',
    width: dims.width,
    height: dims.height,
    margin: { l: 58, r: 18, t: 10, b: 46 },

    // ── I subplot (top) ──────────────────────────────────────────────────────
    xaxis: {
      anchor: 'y', matches: 'x2',
      color: '#3a4a6a', gridcolor: '#141c2e',
      tickfont: { color: '#5a7090', size: 9, family: 'monospace' },
      showticklabels: false,  // shared X shown only on bottom panel
    },
    yaxis: {
      domain: [0.54, 1.0],
      title: { text: 'I  (In-Phase)', font: { color: '#00d4ff', size: 10, family: 'monospace' } },
      color: '#3a4a6a', gridcolor: '#141c2e',
      tickfont: { color: '#5a7090', size: 9, family: 'monospace' },
      zeroline: true, zerolinecolor: '#1e2e48', zerolinewidth: 1,
    },

    // ── Q subplot (bottom) ───────────────────────────────────────────────────
    xaxis2: {
      anchor: 'y2',
      title: { text: 'Time (ms)', font: { color: '#5a6a8a', size: 10, family: 'monospace' } },
      color: '#3a4a6a', gridcolor: '#141c2e',
      tickfont: { color: '#5a7090', size: 9, family: 'monospace' },
    },
    yaxis2: {
      domain: [0.0, 0.46],
      title: { text: 'Q  (Quadrature)', font: { color: '#ff6b8a', size: 10, family: 'monospace' } },
      color: '#3a4a6a', gridcolor: '#141c2e',
      tickfont: { color: '#5a7090', size: 9, family: 'monospace' },
      zeroline: true, zerolinecolor: '#1e2e48', zerolinewidth: 1,
    },

    // ── shared opts ─────────────────────────────────────────────────────────
    dragmode: 'zoom',
    modebar: { bgcolor: 'transparent', color: '#3a5070', activecolor: '#00d4ff' },
    legend: {
      font: { color: '#7a8aaa', size: 9, family: 'monospace' },
      bgcolor: 'rgba(8,12,24,0.7)', bordercolor: '#141c2e', borderwidth: 1,
      x: 1, xanchor: 'right', y: 1.02,
    },
    showlegend: allTraces.length > 2,

    // divider line between panels
    shapes: [{
      type: 'line',
      xref: 'paper', yref: 'paper',
      x0: 0, x1: 1, y0: 0.5, y1: 0.5,
      line: { color: '#1e2e48', width: 1 },
    }],

    // I-panel label
    annotations: [
      {
        xref: 'paper', yref: 'paper', x: 0.01, y: 1.0, xanchor: 'left', yanchor: 'top',
        text: '<b>I</b>', showarrow: false,
        font: { color: '#00d4ff', size: 11, family: 'monospace' }
      },
      {
        xref: 'paper', yref: 'paper', x: 0.01, y: 0.46, xanchor: 'left', yanchor: 'top',
        text: '<b>Q</b>', showarrow: false,
        font: { color: '#ff6b8a', size: 11, family: 'monospace' }
      },
    ],
  };

  const noFile = targetIds.length === 0 || error === 'no_file';
  const hasData = allTraces.length > 0;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a' }}>

      {/* ── header bar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '7px 12px', borderBottom: '1px solid #141c2e', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#5a6a8a', fontFamily: 'monospace', letterSpacing: '0.1em' }}>IQ TIME SERIES</span>
        <span style={{ fontSize: 10, color: '#4a5a7a', fontFamily: 'monospace' }}>
          <span style={{ color: '#00d4ff' }}>■</span> I — In-Phase
          &nbsp;&nbsp;
          <span style={{ color: '#ff6b8a' }}>■</span> Q — Quadrature
        </span>
        {loading && <span style={{ fontSize: 9, color: '#3a5070', fontFamily: 'monospace', marginLeft: 'auto' }}>UPDATING…</span>}
        {compareMode && (
          <span style={{ fontSize: 9, color: '#3a5070', fontFamily: 'monospace', marginLeft: 'auto' }}>
            {Object.keys(datasets).length} FILES
          </span>
        )}
      </div>

      {/* ── plot area ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {noFile && <Center><Msg>NO FILE LOADED</Msg></Center>}
        {!noFile && error && <Center><Msg c="#ff4d6d">ERROR: {error}</Msg></Center>}
        {loading && !hasData && !error && !noFile && <Spin />}
        {hasData && (
          <Plot
            data={allTraces}
            layout={layout}
            revision={revision}
            config={{ displayModeBar: true, displaylogo: false, responsive: true, scrollZoom: true }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function adjustAlpha(color, alpha) {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

const Center = ({ children }) => <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>{children}</div>;
const Msg = ({ children, c = '#3a5070' }) => <div style={{ color: c, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.1em' }}>{children}</div>;
const Spin = () => <Center><div style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #1e2a40', borderTop: '2px solid #00d4ff', animation: 'spin .8s linear infinite' }} /></Center>;
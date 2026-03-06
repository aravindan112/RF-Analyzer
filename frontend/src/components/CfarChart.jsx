import { useEffect, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';

// FIX: use hostname so this works outside localhost
const BASE = `http://${window.location.hostname}:8000`;

export default function CfarChart({
  activeDatasetId,
  positionMs = 0,
  windowMs = 10,
  dspVersion = 0,
  cfarFft = 1024,
  guardCells = 4,
  refCells = 20,
  thresholdDb = 20,
  compareMode = false,
  compareIds = [],
  fileColors = ['#00d4ff', '#ff6b8a', '#5ade9a', '#ffc046'],
}) {
  const [datasets, setDatasets]   = useState({});
  const [error, setError]         = useState(null);
  const [loading, setLoading]     = useState(false);
  const [dims, setDims]           = useState({ width: 800, height: 400 });
  const [revision, setRevision]   = useState(0);
  const containerRef  = useRef(null);
  const pollRef       = useRef(null);
  const fetchingRef   = useRef(false);

  // ── resize observer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({
        width:  Math.floor(width  - 2),
        height: Math.floor(Math.max(height - 52, 260)),
      });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const targetIds = compareMode && compareIds.length > 0
    ? compareIds
    : (activeDatasetId ? [activeDatasetId] : []);

  // ── fetch ────────────────────────────────────────────────────────────────
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
          const p = new URLSearchParams({
            dataset_id:   id,
            position_ms:  positionMs,
            window_ms:    windowMs,
            fft_size:     cfarFft,
            guard_cells:  guardCells,
            ref_cells:    refCells,
            threshold_db: thresholdDb,
          });
          return fetch(`${BASE}/api/cfar?${p}`)
            .then(r => r.json())
            .then(json => ({ id, json }))
            .catch(() => ({ id, json: { error: 'fetch failed' } }));
        })
      );

      const next = {};
      results.forEach(({ id, json }) => { if (!json.error) next[id] = json; });
      if (Object.keys(next).length === 0)
        throw new Error(results[0]?.json?.error || 'No data');

      setDatasets(next);
      setRevision(r => r + 1);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [targetIds.join(','), positionMs, windowMs, dspVersion, cfarFft, guardCells, refCells, thresholdDb]);

  useEffect(() => {
    fetchData();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchData, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchData]);

  // ── build traces ─────────────────────────────────────────────────────────
  const traces = [];
  let totalDetections = 0;

  targetIds.forEach((id, idx) => {
    const d = datasets[id];
    if (!d?.freqs?.length) return;

    const color  = fileColors[idx % fileColors.length];
    const isMain = id === activeDatasetId;
    totalDetections += d.num_detections || 0;

    // Power spectrum
    traces.push({
      x: d.freqs,
      y: d.power_db,
      type: 'scatter',
      mode: 'lines',
      name: `${id.length > 16 ? id.slice(0, 14) + '…' : id} Power`,
      line: { color, width: isMain ? 1.6 : 1.2 },
      fill: isMain ? 'tozeroy' : 'none',
      fillcolor: isMain ? hexToRgba(color, 0.06) : 'transparent',
      hovertemplate: `<b>${id}</b><br>%{x:.3f} MHz<br>%{y:.1f} dB<extra></extra>`,
    });

    // CFAR threshold line
    traces.push({
      x: d.freqs,
      y: d.threshold,
      type: 'scatter',
      mode: 'lines',
      name: `${id.length > 16 ? id.slice(0, 14) + '…' : id} Threshold`,
      line: { color: hexToRgba(color, 0.4), width: 1, dash: 'dot' },
      hovertemplate: `Threshold: %{y:.1f} dB<extra></extra>`,
      showlegend: false,
    });

    // Detection markers
    if (d.peak_freqs?.length) {
      traces.push({
        x: d.peak_freqs,
        y: d.peak_powers,
        type: 'scatter',
        mode: 'markers',
        name: `${id.length > 16 ? id.slice(0, 14) + '…' : id} Detections`,
        marker: {
          color: '#ff4d6d',
          size: isMain ? 9 : 7,
          symbol: 'triangle-up',
          line: { color: '#fff', width: 1 },
        },
        hovertemplate: `<b>DETECT</b> %{x:.3f} MHz | %{y:.1f} dB<extra></extra>`,
        showlegend: false,
      });
    }
  });

  // ── layout ───────────────────────────────────────────────────────────────
  const layout = {
    uirevision: targetIds.join(','),
    paper_bgcolor: '#0a0e1a',
    plot_bgcolor:  '#080c18',
    margin: { l: 58, r: 24, t: 14, b: 48 },
    width:  dims.width,
    height: dims.height,
    xaxis: {
      title: { text: 'Frequency (MHz)', font: { color: '#5a6a8a', size: 11 } },
      color: '#3a4a6a', gridcolor: '#141c2e',
      tickfont: { color: '#5a7090', size: 10 },
    },
    yaxis: {
      title: { text: 'Power (dB)', font: { color: '#5a6a8a', size: 11 } },
      color: '#3a4a6a', gridcolor: '#141c2e',
      tickfont: { color: '#5a7090', size: 10 },
    },
    legend: {
      font: { color: '#8892b0', size: 10 },
      bgcolor: 'rgba(10,14,26,0.85)',
      x: 0.01, y: 0.99,
      bordercolor: '#1e2a40', borderwidth: 1,
    },
    dragmode: 'zoom',
    modebar: { bgcolor: 'transparent', color: '#3a5070', activecolor: '#00d4ff' },
  };

  const noFile   = targetIds.length === 0 || error === 'no_file';
  const hasChart = traces.length > 0;

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a' }}
    >
      {/* ── toolbar ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderBottom: '1px solid #141c2e', flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: '#5a6a8a', fontFamily: 'monospace', letterSpacing: '0.1em' }}>
          CFAR DETECTION
        </span>
        <span style={{ fontSize: 10, color: '#3a4a6a', fontFamily: 'monospace' }}>
          FFT: {cfarFft} · Guard: {guardCells} · Ref: {refCells} · Thresh: {thresholdDb} dB
        </span>
        {loading && (
          <span style={{ fontSize: 9, color: '#3a5070', fontFamily: 'monospace' }}>UPDATING…</span>
        )}
        {hasChart && (
          <span style={{
            fontSize: 10, fontFamily: 'monospace', marginLeft: 'auto',
            color: totalDetections > 0 ? '#ff4d6d' : '#3a4a6a',
          }}>
            {totalDetections} detection{totalDetections !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── chart ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {noFile    && <Center><Msg>NO FILE LOADED</Msg></Center>}
        {!noFile && error && (
          <Center>
            <Msg c="#ff4d6d">ERROR: {error}</Msg>
            <Btn onClick={fetchData}>RETRY</Btn>
          </Center>
        )}
        {loading && !hasChart && !error && !noFile && <Spin />}
        {hasChart && (
          <Plot
            data={traces}
            layout={layout}
            revision={revision}
            config={{ displayModeBar: true, displaylogo: false, responsive: true, scrollZoom: true }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  if (!hex?.startsWith('#')) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const Center = ({ children }) => (
  <div style={{
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 10,
  }}>
    {children}
  </div>
);
const Msg = ({ children, c = '#3a5070' }) => (
  <div style={{ color: c, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.1em' }}>
    {children}
  </div>
);
const Btn = ({ children, onClick }) => (
  <button onClick={onClick} style={{
    padding: '5px 14px', background: 'transparent',
    border: '1px solid #ff4d6d', color: '#ff4d6d',
    cursor: 'pointer', fontSize: 11, fontFamily: 'monospace',
  }}>
    {children}
  </button>
);
const Spin = () => (
  <Center>
    <div style={{
      width: 30, height: 30, borderRadius: '50%',
      border: '2px solid #1e2a40', borderTop: '2px solid #00d4ff',
      animation: 'spin .8s linear infinite',
    }} />
  </Center>
);
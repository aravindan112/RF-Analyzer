/**
 * ConstellationChart.jsx
 * Fixes: dspVersion re-fetch + compare mode overlay
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';

const BASE = `http://${window.location.hostname}:8000`;

export default function ConstellationChart({
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
  const [dims, setDims] = useState({ width: 600, height: 500 });
  const [center, setCenter] = useState(false);
  const containerRef = useRef(null);
  const pollRef = useRef(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ width: Math.floor(width - 2), height: Math.floor(Math.max(height - 56, 200)) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const targetIds = compareMode && compareIds.length > 0 ? compareIds : (activeDatasetId ? [activeDatasetId] : []);

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
          const p = new URLSearchParams({ dataset_id: id, position_ms: positionMs, window_ms: windowMs, center_data: center });
          return fetch(`${BASE}/api/constellation?${p}`)
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
  }, [targetIds.join(','), positionMs, windowMs, dspVersion, center]);

  useEffect(() => {
    fetchData();
    clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchData, 3000);
    return () => clearInterval(pollRef.current);
  }, [fetchData]);

  const traces = Object.entries(datasets).map(([id, d], idx) => {
    const globalIdx = compareIds.indexOf(id);
    const colorIdx = globalIdx >= 0 ? globalIdx : idx;
    const color = fileColors[colorIdx % fileColors.length];
    const shortId = id.length > 16 ? id.slice(0, 14) + '…' : id;
    return {
      x: d.i, y: d.q,
      type: 'scatter', mode: 'markers',
      name: Object.keys(datasets).length > 1 ? shortId : 'IQ',
      marker: { color, size: 2, opacity: 0.6 },
      hovertemplate: 'I:%{x:.4f} Q:%{y:.4f}<extra></extra>',
    };
  });

  const layout = {
    uirevision: 'constellation',
    paper_bgcolor: '#0a0e1a', plot_bgcolor: '#080c18',
    margin: { l: 52, r: 16, t: 10, b: 48 },
    width: dims.width, height: dims.height,
    xaxis: { title: { text: 'In-Phase (I)', font: { color: '#5a6a8a', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 }, zeroline: true, zerolinecolor: '#2a3a5a', scaleanchor: 'y', scaleratio: 1 },
    yaxis: { title: { text: 'Quadrature (Q)', font: { color: '#5a6a8a', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 }, zeroline: true, zerolinecolor: '#2a3a5a' },
    dragmode: 'zoom',
    modebar: { bgcolor: 'transparent', color: '#3a5070', activecolor: '#00d4ff' },
    legend: { font: { color: '#7a8aaa', size: 9, family: 'monospace' }, bgcolor: 'rgba(8,12,24,0.7)', bordercolor: '#141c2e', borderwidth: 1 },
    showlegend: traces.length > 1,
  };

  const noFile = targetIds.length === 0 || error === 'no_file';
  const hasData = traces.length > 0;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '7px 12px', borderBottom: '1px solid #141c2e', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#5a6a8a', fontFamily: 'monospace', letterSpacing: '0.1em' }}>CONSTELLATION</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: center ? '#00d4ff' : '#4a5a7a', fontFamily: 'monospace', cursor: 'pointer' }}>
          <input type="checkbox" checked={center} onChange={e => setCenter(e.target.checked)} style={{ accentColor: '#00d4ff' }} />CENTER
        </label>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {noFile && <Center><Msg>NO FILE LOADED</Msg></Center>}
        {!noFile && error && <Center><Msg c="#ff4d6d">ERROR: {error}</Msg></Center>}
        {loading && !hasData && !error && !noFile && <Spin />}
        {hasData && (
          <Plot data={traces} layout={layout} revision={revision}
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

const Center = ({ children }) => <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>{children}</div>;
const Msg = ({ children, c = '#3a5070' }) => <div style={{ color: c, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.1em' }}>{children}</div>;
const Spin = () => <Center><div style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #1e2a40', borderTop: '2px solid #00d4ff', animation: 'spin .8s linear infinite' }} /></Center>;
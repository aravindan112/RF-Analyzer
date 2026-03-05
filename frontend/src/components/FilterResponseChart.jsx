import { useEffect, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';
const BASE = `http://${window.location.hostname}:8000`;

export default function FilterResponseChart({ dspVersion = 0, lpfEnabled = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dims, setDims] = useState({ width: 800, height: 420 });
  const [revision, setRevision] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ width: Math.floor(width - 2), height: Math.floor(Math.max(height - 52, 280)) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/filter_response`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json); setRevision(r => r + 1); setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [dspVersion]); // re-fetches on every Apply & Refresh

  useEffect(() => { fetchData(); }, [fetchData]);

  const plotData = data?.freqs_mhz?.length ? [
    { x: data.freqs_mhz, y: data.mag_db, type: 'scatter', mode: 'lines', name: 'Magnitude (dB)', line: { color: '#00d4ff', width: 2 }, yaxis: 'y', hovertemplate: '%{x:.3f} MHz | %{y:.1f} dB<extra></extra>' },
    { x: data.freqs_mhz, y: data.phase_deg, type: 'scatter', mode: 'lines', name: 'Phase (°)', line: { color: '#ff6b9d', width: 1.5, dash: 'dot' }, yaxis: 'y2', hovertemplate: '%{x:.3f} MHz | %{y:.1f}°<extra></extra>' },
  ] : [];

  const layout = {
    uirevision: 'filter',
    paper_bgcolor: '#0a0e1a', plot_bgcolor: '#080c18',
    margin: { l: 58, r: 62, t: 14, b: 48 },
    width: dims.width, height: dims.height,
    xaxis: { title: { text: 'Frequency (MHz)', font: { color: '#5a6a8a', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 } },
    yaxis: { title: { text: 'Magnitude (dB)', font: { color: '#00d4ff', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 } },
    yaxis2: { title: { text: 'Phase (°)', font: { color: '#ff6b9d', size: 11 } }, overlaying: 'y', side: 'right', gridcolor: 'transparent', tickfont: { color: '#ff6b9d', size: 10 } },
    legend: { font: { color: '#8892b0', size: 11 }, bgcolor: 'rgba(10,14,26,0.85)', x: .3, y: .05, bordercolor: '#1e2a40', borderwidth: 1 },
    dragmode: 'zoom', modebar: { bgcolor: 'transparent', color: '#3a5070', activecolor: '#00d4ff' },
  };

  const hasChart = data?.freqs_mhz?.length > 0;
  // Detect "LPF disabled" errors from backend
  const isLpfOff = !lpfEnabled || (error && /lpf|filter|disabled|no\s*taps/i.test(error));

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderBottom: '1px solid #141c2e' }}>
        <span style={{ fontSize: 11, color: '#5a6a8a', fontFamily: 'monospace', letterSpacing: '0.1em' }}>FILTER RESPONSE</span>
        {data && <span style={{ fontSize: 10, color: '#3a4a6a', fontFamily: 'monospace' }}>taps: {data.num_taps} · {data.window}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: 'monospace', color: lpfEnabled ? '#5a9a6a' : '#ff4d6d' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: lpfEnabled ? '#5a9a6a' : '#ff4d6d' }} />
          {lpfEnabled ? 'LPF ON' : 'LPF OFF'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11, fontFamily: 'monospace', color: '#5a6a8a' }}>
          <span>MAG <span style={{ color: '#00d4ff' }}>━</span></span>
          <span>PHASE <span style={{ color: '#ff6b9d' }}>╌</span></span>
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {isLpfOff && !hasChart && (
          <Center>
            <span style={{ fontSize: 28, opacity: .2 }}>⚡</span>
            <Msg c="#ff9a3c">LOW-PASS FILTER IS DISABLED</Msg>
            <div style={{ color: '#3a5070', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', lineHeight: 1.8 }}>
              Enable <span style={{ color: '#00d4ff' }}>Low-Pass Filter</span> in the sidebar<br />
              then click <span style={{ color: '#00d4ff' }}>⟳ APPLY &amp; REFRESH</span>
            </div>
          </Center>
        )}
        {!isLpfOff && error && <Center><Msg c="#ff4d6d">ERROR: {error}</Msg><Btn onClick={fetchData}>RETRY</Btn></Center>}
        {loading && !hasChart && !isLpfOff && !error && <Spin />}
        {hasChart && <Plot data={plotData} layout={layout} revision={revision}
          config={{ displayModeBar: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'], displaylogo: false, responsive: true, scrollZoom: true }}
          style={{ width: '100%', height: '100%' }} useResizeHandler />}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const Center = ({ children }) => <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>{children}</div>;
const Msg = ({ children, c = '#3a5070' }) => <div style={{ color: c, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.1em' }}>{children}</div>;
const Btn = ({ children, onClick }) => <button onClick={onClick} style={{ padding: '5px 14px', background: 'transparent', border: '1px solid #ff4d6d', color: '#ff4d6d', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace' }}>{children}</button>;
const Spin = () => <Center><div style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #1e2a40', borderTop: '2px solid #00d4ff', animation: 'spin .8s linear infinite' }} /></Center>;
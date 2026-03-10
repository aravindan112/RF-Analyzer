import { useEffect, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';
const BASE = '';

export default function SpectrogramChart({
  activeDatasetId,
  positionMs = 0,
  windowMs = 50,
  fftSize = 1024,
  dspVersion = 0,
  compareMode = false,
  compareIds = [],
  fileColors = ['#00d4ff', '#ff6b8a', '#5ade9a', '#ffc046'],
  fileOrder = [],
}) {
  const [datasets, setDatasets] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dims, setDims] = useState({ width: 800, height: 420 });
  const [revision, setRevision] = useState(0);
  const containerRef = useRef(null);

  const fetchingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ width: Math.floor(width - 2), height: Math.floor(Math.max(height - 52, 280)) });
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
          const p = new URLSearchParams({
            dataset_id: id,
            position_ms: positionMs,
            window_ms: Math.max(windowMs, 20),
            fft_size: fftSize,   // FIX: was hardcoded 256, now uses prop
          });
          return fetch(`${BASE}/api/spectrogram?${p}`)
            .then(r => r.json())
            .then(json => ({ id, json }))
            .catch(() => ({ id, json: { error: 'fetch failed' } }));
        })
      );
      const next = {};
      results.forEach(({ id, json }) => { if (!json.error) next[id] = json; });
      if (Object.keys(next).length === 0) throw new Error(results[0]?.json?.error || 'No data');
      setDatasets(next);
      setRevision(r => r + 1);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); fetchingRef.current = false; }
  }, [targetIds.join(','), positionMs, windowMs, fftSize, dspVersion]); // FIX: fftSize in deps

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Prune stale datasets when targetIds changes
  useEffect(() => {
    setDatasets(prev => {
      const valid = new Set(targetIds);
      const pruned = {};
      for (const k of Object.keys(prev)) { if (valid.has(k)) pruned[k] = prev[k]; }
      return Object.keys(pruned).length === Object.keys(prev).length ? prev : pruned;
    });
  }, [targetIds.join(',')]);

  const multi = targetIds.length > 1;
  const plotData = [];
  const layout = {
    uirevision: targetIds.join(','),
    paper_bgcolor: '#0a0e1a', plot_bgcolor: '#080c18',
    margin: { l: 58, r: 60, t: 30, b: 48 },
    width: dims.width, height: dims.height,
    dragmode: 'zoom', modebar: { bgcolor: 'transparent', color: '#3a5070', activecolor: '#00d4ff' },
    annotations: [],
  };

  targetIds.forEach((id, idx) => {
    const d = datasets[id];
    if (!d?.spec?.length) return;

    const yaxisLabel = idx === 0 ? 'y' : `y${idx + 1}`;
    const xaxisLabel = idx === 0 ? 'x' : `x${idx + 1}`;

    plotData.push({
      z: d.spec, x: d.freqs, y: d.times, type: 'heatmap',
      xaxis: xaxisLabel, yaxis: yaxisLabel,
      colorscale: [
        [0, '#0a0e1a'], [0.25, '#0a2a4a'],
        [0.5, '#0a4a6a'], [0.75, '#00d4ff'], [1, '#ffdd00']
      ],
      zsmooth: 'best', showscale: idx === 0,
      colorbar: {
        thickness: 12, len: .9,
        tickfont: { color: '#5a7090', size: 9, family: 'monospace' },
        title: { text: 'dB', font: { color: '#5a6a8a', size: 10 }, side: 'right' },
        bgcolor: 'transparent', bordercolor: '#1e2a40'
      },
      hovertemplate: `<b>${id.slice(0, 20)}</b><br>%{x:.2f} MHz<br>%{y:.2f} ms<br>%{z:.1f} dB<extra></extra>`,
    });

    const domainSize = 1 / targetIds.length;
    const padding = 0.05;
    const bottom = 1 - (idx + 1) * domainSize + padding / 2;
    const top = 1 - idx * domainSize - padding / 2;

    layout[`yaxis${idx === 0 ? '' : idx + 1}`] = {
      domain: [bottom, top],
      title: { text: multi ? `${id.slice(0, 10)}... (ms)` : 'Time (ms)', font: { color: '#5a6a8a', size: 10 } },
      color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 9 }
    };

    layout[`xaxis${idx === 0 ? '' : idx + 1}`] = {
      anchor: yaxisLabel,
      title: idx === targetIds.length - 1
        ? { text: 'Frequency (MHz)', font: { color: '#5a6a8a', size: 11 } }
        : null,
      color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 },
      showticklabels: idx === targetIds.length - 1
    };

    if (multi) {
      const fi = fileOrder.indexOf(id);
      layout.annotations.push({
        xref: 'paper', yref: 'paper',
        x: 0, y: top, xanchor: 'left', yanchor: 'bottom',
        text: `<b>${id}</b>`, showarrow: false,
        font: { color: fileColors[(fi >= 0 ? fi : idx) % fileColors.length], size: 10, family: 'monospace' }
      });
    }
  });

  const noFile = targetIds.length === 0 || error === 'no_file';
  const hasChart = plotData.length > 0;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid #141c2e' }}>
        <span style={{ fontSize: 11, color: '#5a6a8a', fontFamily: 'monospace', letterSpacing: '0.1em' }}>SPECTROGRAM</span>
        <span style={{ fontSize: 10, color: '#3a4a6a', fontFamily: 'monospace' }}>FFT: {fftSize}</span>
        {multi && <span style={{ fontSize: 10, color: '#3a4a6a', fontFamily: 'monospace' }}>{targetIds.length} files compared</span>}
        {loading && <span style={{ fontSize: 9, color: '#3a5070', fontFamily: 'monospace', marginLeft: 'auto' }}>UPDATING…</span>}
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {noFile && <Center><Msg>NO FILE LOADED</Msg></Center>}
        {!noFile && error && <Center><Msg c="#ff4d6d">ERROR: {error}</Msg><Btn onClick={fetchData}>RETRY</Btn></Center>}
        {loading && !hasChart && !error && !noFile && <Spin />}
        {hasChart && (
          <Plot data={plotData} layout={layout} revision={revision}
            config={{ displayModeBar: true, displaylogo: false, responsive: true, scrollZoom: true }}
            style={{ width: '100%', height: '100%' }} useResizeHandler />
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const Center = ({ children }) => <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>{children}</div>;
const Msg = ({ children, c = '#3a5070' }) => <div style={{ color: c, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.1em' }}>{children}</div>;
const Btn = ({ children, onClick }) => <button onClick={onClick} style={{ padding: '5px 14px', background: 'transparent', border: '1px solid #ff4d6d', color: '#ff4d6d', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace' }}>{children}</button>;
const Spin = () => <Center><div style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #1e2a40', borderTop: '2px solid #00d4ff', animation: 'spin .8s linear infinite' }} /></Center>;
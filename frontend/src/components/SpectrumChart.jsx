import React, { useEffect, useState, useRef, useCallback } from 'react';
import Plot from 'react-plotly.js';

const BASE = '' ;
const mono = { fontFamily: 'monospace' };

// ─── Small UI atoms ───────────────────────────────────────────────────────────

function StatCard({ label, value, unit, color = '#00d4ff', wide = false }) {
  return (
    <div style={{ background: '#090d1a', border: `1px solid ${color}22`, borderLeft: `2px solid ${color}`, borderRadius: 4, padding: '5px 10px', minWidth: wide ? 140 : 100, flexShrink: 0 }}>
      <div style={{ fontSize: 8, color: '#4a5a7a', ...mono, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, ...mono, color, lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 3 }}>
        {value ?? '—'}{unit && <span style={{ fontSize: 9, color: `${color}88`, fontWeight: 400 }}>{unit}</span>}
      </div>
    </div>
  );
}

function SnrBar({ snr }) {
  const v = Math.min(100, Math.max(0, snr ?? 0));
  const c = v > 30 ? '#5ade9a' : v > 15 ? '#ffc046' : '#ff4d6d';
  return (
    <div style={{ background: '#090d1a', border: `1px solid ${c}22`, borderLeft: `3px solid ${c}`, borderRadius: 5, padding: '7px 14px', minWidth: 150, flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: '#4a5a7a', ...mono, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>SNR</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 6, background: '#141c2e', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${v}%`, height: '100%', background: `linear-gradient(90deg,${c}88,${c})`, borderRadius: 3, transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, ...mono, color: c, minWidth: 52, textAlign: 'right' }}>
          {snr != null ? snr.toFixed(1) : '—'} <span style={{ fontSize: 9, fontWeight: 400, color: `${c}99` }}>dB</span>
        </span>
      </div>
    </div>
  );
}

function TLabel({ children }) {
  return <span style={{ fontSize: 9, color: '#3a5070', ...mono, letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 4 }}>{children}</span>;
}

function TInput({ label, value, onChange, onCommit, min, max, step = 'any', unit, width = 72 }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => {
    const n = Number(local);
    if (!isNaN(n)) { onChange(n); onCommit?.(); } else setLocal(String(value));
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <TLabel>{label}{unit ? ` (${unit})` : ''}</TLabel>
      <input type="number" value={local} min={min} max={max} step={step}
        onChange={e => setLocal(e.target.value)} onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        style={{ width, background: '#080c18', border: '1px solid #1e2a3a', color: '#00d4ff', padding: '3px 6px', fontSize: 11, ...mono, borderRadius: 3, outline: 'none' }}
      />
    </div>
  );
}

function TSelect({ label, value, onChange, options, width = 120 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <TLabel>{label}</TLabel>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width, background: '#080c18', border: '1px solid #1e2a3a', color: '#00d4ff', padding: '3px 6px', fontSize: 11, ...mono, borderRadius: 3, cursor: 'pointer' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function TCheck({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 10, color: checked ? '#00d4ff' : '#4a5a7a', ...mono, userSelect: 'none', flexShrink: 0 }}>
      <div onClick={onChange} style={{ width: 13, height: 13, border: `1px solid ${checked ? '#00d4ff' : '#2a3a5a'}`, background: checked ? 'rgba(0,212,255,0.15)' : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {checked && <div style={{ width: 6, height: 6, background: '#00d4ff', borderRadius: 1 }} />}
      </div>
      {label}
    </label>
  );
}

function VSep() { return <div style={{ width: 1, height: 20, background: '#1a2535', flexShrink: 0 }} />; }
const Center = ({ children }) => <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>{children}</div>;
const Msg = ({ children, c = '#3a5070' }) => <div style={{ color: c, ...mono, fontSize: 12, letterSpacing: '0.1em' }}>{children}</div>;
const Retry = ({ onClick }) => <button onClick={onClick} style={{ padding: '5px 14px', background: 'transparent', border: '1px solid #ff4d6d', color: '#ff4d6d', cursor: 'pointer', fontSize: 11, ...mono }}>RETRY</button>;
const Spin = () => <Center><div style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #1e2a40', borderTop: '2px solid #00d4ff', animation: 'spin .8s linear infinite' }} /></Center>;

function hexToRgba(hex, a) {
  if (!hex?.startsWith('#')) return hex;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
const safeMax = a => a.reduce((m, v) => v > m ? v : m, -Infinity);
const safeMin = a => a.reduce((m, v) => v < m ? v : m, Infinity);

// ─── Main component ───────────────────────────────────────────────────────────

export default function SpectrumChart({
  activeDatasetId, positionMs = 0, windowMs = 10, dspVersion = 0, fftSize = 1024,
  compareMode = false, compareIds = [], fileColors = ['#00d4ff', '#ff6b8a', '#5ade9a', '#ffc046'],
  fileOrder = [],
  onRemoveFile,
  // zsWindowMs is lifted to App.jsx so the position bar clamps correctly
  zsWindowMs: zsWindowMsProp = 100.0,
  onZsWindowChange,
}) {
  const [mode, setMode] = useState('freq');
  const [datasets, setDatasets] = useState({});
  const [fsError, setFsError] = useState(null);
  const [fsLoading, setFsLoading] = useState(false);
  const [avgFrames, setAvgFrames] = useState(false);
  const [normalise, setNormalise] = useState(false);

  const [centerMhz, setCenterMhz] = useState(0.0);
  // zsWindowMs is driven by prop; local setter notifies parent
  const zsWindowMs = zsWindowMsProp;
  const setZsWindowMs = useCallback((v) => {
    if (onZsWindowChange) onZsWindowChange(v);
  }, [onZsWindowChange]);

  const [zsFftSize, setZsFftSize] = useState(512);
  const [dcDownconvert, setDcDownconvert] = useState(true);

  const [zsData, setZsData] = useState(null);
  const [zsError, setZsError] = useState(null);
  const [zsLoading, setZsLoading] = useState(false);
  // 'stopped' | 'running' | 'waiting'
  const [zsState, setZsState] = useState('stopped');

  const [revision, setRevision] = useState(0);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);

  // Live params — loop reads fresh values every iteration, never stale
  const P = useRef({});
  useEffect(() => {
    P.current = {
      activeDatasetId, centerMhz, positionMs, zsWindowMs, zsFftSize,
      dcDownconvert, dspVersion,
      windowMs, fftSize, avgFrames, normalise, compareMode, compareIds,
    };
  });

  const ctrlRef = useRef(null);
  const fsFetchingRef = useRef(false);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ width: Math.floor(width - 4), height: Math.floor(Math.max(height - 4, 220)) });
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // ── Freq-span fetch ───────────────────────────────────────────────────────
  const fetchFreqSpan = useCallback(async () => {
    const p = P.current;
    const ids = p.compareMode && p.compareIds?.length > 0
      ? p.compareIds : (p.activeDatasetId ? [p.activeDatasetId] : []);
    if (fsFetchingRef.current || ids.length === 0) { if (!ids.length) setFsError('no_file'); return; }
    fsFetchingRef.current = true; setFsLoading(true);
    try {
      const results = await Promise.all(ids.map(id => {
        const qs = new URLSearchParams({
          dataset_id: id, position_ms: p.positionMs,
          window_ms: p.windowMs, fft_size: p.fftSize, average_frames: p.avgFrames, normalize_db: p.normalise
        });
        return fetch(`${BASE}/api/spectrum?${qs}`).then(r => r.json()).then(json => ({ id, json }))
          .catch(() => ({ id, json: { error: 'fetch failed' } }));
      }));
      const next = {};
      results.forEach(({ id, json }) => { if (!json.error) next[id] = json; });
      if (!Object.keys(next).length) throw new Error(results[0]?.json?.error || 'No data');
      setDatasets(next); setRevision(r => r + 1); setFsError(null);
    } catch (e) { setFsError(e.message); }
    finally { setFsLoading(false); fsFetchingRef.current = false; }
  }, []);

  // ── zs_stop ───────────────────────────────────────────────────────────────
  const zs_stop = useCallback(() => {
    if (ctrlRef.current) {
      ctrlRef.current.abort();
      ctrlRef.current = null;
    }
    setZsLoading(false);
    setZsState('stopped');
  }, []);

  // ── zs_start ─────────────────────────────────────────────────────────────
  const zs_start = useCallback(() => {
    if (ctrlRef.current) {
      ctrlRef.current.abort();
    }
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    if (!P.current.activeDatasetId) {
      ctrlRef.current = null;
      return;
    }

    setZsError(null);
    setZsState('running');

    function abortableDelay(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        ctrl.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }

    (async () => {
      while (true) {
        if (ctrl.signal.aborted) break;

        const p = P.current;
        setZsLoading(true);

        let data;
        try {
          const qs = new URLSearchParams({
            dataset_id: p.activeDatasetId,
            center_mhz: p.centerMhz,
            position_ms: p.positionMs,
            zs_window_ms: p.zsWindowMs,
            zs_fft_size: p.zsFftSize,
            trigger_mode: 'free',
            trigger_level_db: -200,
            dc_downconvert: p.dcDownconvert,
          });
          const res = await fetch(`${BASE}/api/zero_span?${qs}`, { signal: ctrl.signal });
          data = await res.json();
        } catch (err) {
          if (err.name === 'AbortError') break;
          if (!ctrl.signal.aborted) {
            setZsError(err.message);
            setZsLoading(false);
            setZsState('stopped');
          }
          break;
        }

        if (ctrl.signal.aborted) break;

        setZsLoading(false);

        if (data.error) {
          setZsError(data.error);
          setZsState('stopped');
          break;
        }

        setZsData(data);
        setRevision(r => r + 1);
        setZsState('running');

        await abortableDelay(1000);
        if (ctrl.signal.aborted) break;
      }

      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (ctrlRef.current) { ctrlRef.current.abort(); ctrlRef.current = null; }
    };
  }, []);

  // ── Stop loop when leaving 0-span mode ───────────────────────────────────
  useEffect(() => {
    if (mode !== 'zero') zs_stop();
  }, [mode, zs_stop]);

  // ── Stop loop when active file changes ───────────────────────────────────
  useEffect(() => {
    zs_stop();
  }, [activeDatasetId, zs_stop]);

  // ── Prune stale datasets when targetIds changes ───────────────────────────
  const targetIds = compareMode && compareIds.length > 0 ? compareIds : (activeDatasetId ? [activeDatasetId] : []);
  useEffect(() => {
    setDatasets(prev => {
      const validKeys = new Set(targetIds);
      const pruned = {};
      for (const k of Object.keys(prev)) {
        if (validKeys.has(k)) pruned[k] = prev[k];
      }
      return Object.keys(pruned).length === Object.keys(prev).length ? prev : pruned;
    });
    if (!activeDatasetId) { setZsData(null); setZsError(null); }
  }, [targetIds.join(','), activeDatasetId]);

  // ── Freq-span: refresh on position/window/fft/dsp changes ────────────────
  useEffect(() => {
    if (mode !== 'freq') return;
    fetchFreqSpan();
  }, [mode, activeDatasetId, fetchFreqSpan]);

  useEffect(() => {
    if (mode === 'freq') fetchFreqSpan();
  }, [positionMs, windowMs, fftSize, dspVersion, avgFrames, normalise, fetchFreqSpan]);

  // FIX: also refresh when compareMode or compareIds change.
  // Without this, toggling Compare Mode or checking/unchecking files in the
  // sidebar had no effect on the spectrum until some other param changed.
  useEffect(() => {
    if (mode === 'freq') fetchFreqSpan();
  }, [compareMode, compareIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const zsFetchingRef = useRef(false);
  const fetchZeroSpan = useCallback(async () => {
    const p = P.current;
    if (!p.activeDatasetId || zsFetchingRef.current) return;
    zsFetchingRef.current = true;
    setZsLoading(true);
    try {
      const qs = new URLSearchParams({
        dataset_id: p.activeDatasetId,
        center_mhz: p.centerMhz,
        position_ms: p.positionMs,
        zs_window_ms: p.zsWindowMs,
        zs_fft_size: p.zsFftSize,
        trigger_mode: 'free',
        trigger_level_db: -200,
        dc_downconvert: p.dcDownconvert,
      });
      const res = await fetch(`${BASE}/api/zero_span?${qs}`);
      const data = await res.json();
      if (!data.error) {
        setZsData(data);
        setRevision(r => r + 1);
        setZsError(null);
      }
    } catch (e) {
      // silently ignore — don't disturb stopped state
    } finally {
      setZsLoading(false);
      zsFetchingRef.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const zsStateRef = useRef('stopped');
  useEffect(() => { zsStateRef.current = zsState; }, [zsState]);

  const zsDebounceRef = useRef(null);

  useEffect(() => {
    if (mode !== 'zero') return;
    if (zsDebounceRef.current) clearTimeout(zsDebounceRef.current);
    zsDebounceRef.current = setTimeout(() => {
      zsDebounceRef.current = null;
      if (zsStateRef.current !== 'stopped') {
        zs_start();
      } else {
        fetchZeroSpan();
      }
    }, 300);
    return () => {
      if (zsDebounceRef.current) { clearTimeout(zsDebounceRef.current); zsDebounceRef.current = null; }
    };
  }, [positionMs, zsWindowMs, centerMhz, dspVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Click freq-span → switch to 0-span ───────────────────────────────────
  const handleFreqClick = useCallback((ev) => {
    if (!ev?.points?.length) return;
    const mhz = ev.points[0].x;
    if (typeof mhz !== 'number') return;
    setCenterMhz(parseFloat(mhz.toFixed(4)));
    setMode('zero');
  }, []);

  // ── Derived readouts ──────────────────────────────────────────────────────
  const rbwHz = zsData?.rbw_hz != null ? zsData.rbw_hz : null;
  const rbwDisplay = rbwHz == null ? '—' : rbwHz >= 1000 ? `${(rbwHz / 1000).toFixed(2)} kHz` : `${rbwHz.toFixed(0)} Hz`;
  const timeResDisplay = zsData?.time_res_us != null ? `${Number(zsData.time_res_us).toFixed(1)} µs` : '—';
  const zsPeakPwr = zsData?.powers_db?.length ? safeMax(zsData.powers_db) : null;
  const zsMinPwr = zsData?.powers_db?.length ? safeMin(zsData.powers_db) : null;
  const zsDynRange = zsPeakPwr != null && zsMinPwr != null ? zsPeakPwr - zsMinPwr : null;

  // ── Freq-span traces ──────────────────────────────────────────────────────
  // FIX: peak correctness — `primary` is the dataset with the globally highest
  // peak_db across all loaded datasets. The peak marker is rendered only on
  // the primary trace to avoid duplicate diamonds when in compare mode.
  const primary = Object.values(datasets).reduce((best, d) =>
    (!best || (d.peak_db ?? -Infinity) > (best.peak_db ?? -Infinity)) ? d : best
  , null) ?? datasets[activeDatasetId];

  const fsTraces = Object.entries(datasets).flatMap(([id, d], idx) => {
    const fi = fileOrder.indexOf(id), color = fileColors[(fi >= 0 ? fi : idx) % fileColors.length], isMain = id === activeDatasetId;
    const isPrimary = primary && d.peak_db === primary.peak_db && d.peak_mhz === primary.peak_mhz;
    const out = [{
      x: d.freqs, y: d.power_db, type: 'scatter', mode: 'lines',
      name: id.length > 22 ? id.slice(0, 20) + '…' : id,
      line: { color, width: isMain ? 1.5 : 1.2 }, fill: 'tozeroy', fillcolor: hexToRgba(color, 0.05),
      hovertemplate: `<b>${id.slice(0, 20)}</b><br>%{x:.4f} MHz | %{y:.1f} dB<br><i>Click → 0-Span</i><extra></extra>`,
    }];
    // Only render the peak diamond on the primary (highest-peak) dataset
    if (isPrimary && d.peak_mhz != null) out.push({
      x: [d.peak_mhz], y: [d.peak_db], type: 'scatter', mode: 'markers+text',
      marker: { color: '#ff4d6d', size: 10, symbol: 'diamond', line: { color: '#fff', width: 1 } },
      text: [`  ${d.peak_mhz.toFixed(3)} MHz`], textposition: 'top right',
      textfont: { color: '#ff4d6d', size: 10, family: 'monospace' },
      showlegend: false, name: 'Peak', hovertemplate: `<b>PEAK</b> %{x:.3f} MHz | %{y:.1f} dB<extra></extra>`,
    });
    return out;
  });

  const fsShapes = [], fsAnnotations = [];
  if (primary?.noise_db != null) {
    fsShapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: primary.noise_db, y1: primary.noise_db, line: { color: 'rgba(255,193,70,0.35)', width: 1, dash: 'dot' } });
    fsAnnotations.push({ xref: 'paper', yref: 'y', x: 0.01, y: primary.noise_db, text: `Noise ${primary.noise_db.toFixed(1)} dB`, showarrow: false, font: { color: '#ffc046', size: 9, family: 'monospace' }, yshift: 8 });
  }

  // ── 0-span traces ─────────────────────────────────────────────────────────
  const zsTraces = [];
  if (zsData?.times_ms?.length && zsData?.powers_db?.length) {
    zsTraces.push({
      x: zsData.times_ms, y: zsData.powers_db, type: 'scatter', mode: 'lines',
      name: `${centerMhz.toFixed(4)} MHz`, line: { color: '#00d4ff', width: 1.5 },
      fill: 'tozeroy', fillcolor: 'rgba(0,212,255,0.06)',
      hovertemplate: '%{x:.3f} ms | %{y:.1f} dB<extra></extra>'
    });
    const pkPwr = safeMax(zsData.powers_db), pkIdx = zsData.powers_db.indexOf(pkPwr);
    if (pkIdx >= 0) zsTraces.push({
      x: [zsData.times_ms[pkIdx]], y: [pkPwr], type: 'scatter', mode: 'markers',
      marker: { color: '#ff4d6d', size: 9, symbol: 'diamond', line: { color: '#fff', width: 1 } },
      showlegend: false, hovertemplate: `<b>PEAK</b> %{x:.3f} ms | %{y:.1f} dB<extra></extra>`
    });
  }

  // ── Layouts ───────────────────────────────────────────────────────────────
  const base = {
    paper_bgcolor: '#0a0e1a', plot_bgcolor: '#080c18', margin: { l: 56, r: 20, t: 7, b: 32 },
    width: dims.width, height: dims.height, dragmode: 'zoom',
    modebar: { bgcolor: 'transparent', color: '#3a5070', activecolor: '#00d4ff' }
  };

  const fsLayout = {
    ...base, uirevision: 'spectrum',
    xaxis: { title: { text: 'Frequency (MHz)', font: { color: '#5a6a8a', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 }, zeroline: true, zerolinecolor: '#2a3a5a' },
    yaxis: { title: { text: 'Power (dB)', font: { color: '#5a6a8a', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 } },
    legend: { font: { color: '#7a8aaa', size: 9, family: 'monospace' }, bgcolor: 'rgba(8,12,24,0.7)', bordercolor: '#141c2e', borderwidth: 1, x: 1, xanchor: 'right', y: 1 },
    showlegend: Object.keys(datasets).length > 1, shapes: fsShapes, annotations: fsAnnotations
  };

  const zsLayout = {
    ...base, uirevision: 'zero_span',
    xaxis: { title: { text: `Time (ms)  ·  center ${centerMhz.toFixed(4)} MHz  ·  eff RBW ${rbwDisplay}`, font: { color: '#5a6a8a', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 }, zeroline: false },
    yaxis: { title: { text: 'Power (dBFS)', font: { color: '#5a6a8a', size: 11 } }, color: '#3a4a6a', gridcolor: '#141c2e', tickfont: { color: '#5a7090', size: 10 } },
    showlegend: false,
  };

  // ── Derived UI state ──────────────────────────────────────────────────────
  const noFile = !targetIds.length;
  const noFileZero = !activeDatasetId;
  const fsHasData = fsTraces.length > 0;
  const zsHasData = zsTraces.length > 0;
  const isRunning = zsState !== 'stopped';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a' }}>

      {/* TOOLBAR */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid #141c2e', flexShrink: 0, flexWrap: 'wrap', minHeight: 36 }}>

        <div style={{ display: 'flex', border: '1px solid #1e2a3a', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
          {[['freq', 'FREQ SPAN'], ['zero', '0-SPAN']].map(([m, label]) => (
            <button key={m} onClick={() => { if (m !== mode) setMode(m); }}
              style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', ...mono, cursor: 'pointer', border: 'none', background: mode === m ? '#00d4ff' : 'transparent', color: mode === m ? '#080c18' : '#3a5070', transition: 'all 0.15s' }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'freq' && <>
          <VSep />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: avgFrames ? '#00d4ff' : '#4a5a7a', ...mono, cursor: 'pointer', flexShrink: 0 }}>
            <input type="checkbox" checked={avgFrames} onChange={e => setAvgFrames(e.target.checked)} style={{ accentColor: '#00d4ff' }} /> AVG FRAMES
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: normalise ? '#00d4ff' : '#4a5a7a', ...mono, cursor: 'pointer', flexShrink: 0 }}>
            <input type="checkbox" checked={normalise} onChange={e => setNormalise(e.target.checked)} style={{ accentColor: '#00d4ff' }} /> NORMALISE
          </label>
          <span style={{ fontSize: 9, color: '#2a3a5a', ...mono, border: '1px solid #141c2e', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>TIP: Click plot to tune 0-Span</span>
        </>}

        {mode === 'zero' && <>
          <VSep />
          <TInput label="Center" unit="MHz" value={centerMhz} min={-500} max={500} step={0.001} width={80}
            onChange={setCenterMhz} onCommit={() => { if (isRunning) zs_start(); }} />
          <TInput label="Window" unit="ms" value={zsWindowMs} min={1} max={10000} step={1} width={68}
            onChange={setZsWindowMs} onCommit={() => { if (isRunning) zs_start(); }} />
          <TInput label="FFT" value={zsFftSize} min={64} max={8192} step={64} width={60}
            onChange={v => setZsFftSize(Math.max(64, Math.round(v / 64) * 64))}
            onCommit={() => { if (isRunning) zs_start(); }} />
          <VSep />
          <TCheck label="DC Downconv" checked={dcDownconvert}
            onChange={() => { setDcDownconvert(v => !v); if (isRunning) setTimeout(zs_start, 0); }} />
          <VSep />

          {isRunning ? (
            <div style={{ padding: '3px 10px', borderRadius: 3, fontSize: 9, ...mono, fontWeight: 700, background: 'rgba(90,222,154,0.1)', color: '#5ade9a', border: '1px solid rgba(90,222,154,0.35)', flexShrink: 0 }}>
              ● RUNNING
            </div>
          ) : (
            <div style={{ padding: '3px 10px', borderRadius: 3, fontSize: 9, ...mono, fontWeight: 700, background: 'rgba(74,90,122,0.1)', color: '#4a5a7a', border: '1px solid #1e2a3a', flexShrink: 0 }}>
              ■ STOPPED
            </div>
          )}

          {!isRunning ? (
            <button onClick={zs_start} disabled={!activeDatasetId}
              style={{
                padding: '3px 18px', fontSize: 10, fontWeight: 700, ...mono, cursor: activeDatasetId ? 'pointer' : 'not-allowed',
                border: '1px solid #00d4ff', background: 'rgba(0,212,255,0.1)', color: activeDatasetId ? '#00d4ff' : '#2a4a5a',
                borderRadius: 3, flexShrink: 0, opacity: activeDatasetId ? 1 : 0.5
              }}>
              ▶ RUN
            </button>
          ) : (
            <button onClick={zs_stop}
              style={{
                padding: '3px 18px', fontSize: 10, fontWeight: 700, ...mono, cursor: 'pointer',
                border: '1px solid #ff4d6d', background: 'rgba(255,77,109,0.12)', color: '#ff4d6d',
                borderRadius: 3, flexShrink: 0
              }}>
              ■ STOP
            </button>
          )}
        </>}

        {(mode === 'freq' ? fsLoading : zsLoading) && (
          <span style={{ fontSize: 9, color: '#3a5070', ...mono, marginLeft: 'auto' }}>UPDATING…</span>
        )}
      </div>

      {/* STAT CARDS */}
      {mode === 'freq' && primary && (
        <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: '1px solid #141c2e', flexShrink: 0, overflowX: 'auto', alignItems: 'stretch' }}>
          <StatCard label="Peak Frequency" value={primary.peak_mhz?.toFixed(4)} unit="MHz" color="#00d4ff" wide />
          <StatCard label="Peak Power" value={primary.peak_db?.toFixed(2)} unit="dB" color="#ff6b8a" />
          <StatCard label="Noise Floor" value={primary.noise_db?.toFixed(2)} unit="dB" color="#ffc046" />
          <SnrBar snr={primary.snr_db} />
          <StatCard label="FFT Frames" value={primary.num_frames} color="#9b6bff" />
          <StatCard label="FFT Size" value={fftSize} color="#5ade9a" />
        </div>
      )}
      {mode === 'zero' && zsData && (
        <div style={{ display: 'flex', gap: 6, padding: '5px 12px', borderBottom: '1px solid #141c2e', flexShrink: 0, overflowX: 'auto', alignItems: 'stretch' }}>
          <StatCard label="Center Freq" value={centerMhz.toFixed(4)} unit="MHz" color="#00d4ff" wide />
          <StatCard label="Peak Power" value={zsPeakPwr?.toFixed(2)} unit="dBFS" color="#ff6b8a" />
          <StatCard label="Min Power" value={zsMinPwr?.toFixed(2)} unit="dBFS" color="#ffc046" />
          <StatCard label="Dyn Range" value={zsDynRange?.toFixed(1)} unit="dB" color="#5ade9a" />
          <StatCard label="Eff RBW" value={rbwDisplay} color="#9b6bff" />
          <StatCard label="Δt" value={timeResDisplay} color="#4d9fff" />
          <StatCard label="Bin #" value={zsData.bin_idx} color="#c46bff" />
          <StatCard label="Bins" value={zsData.bin_lo != null ? `${zsData.bin_lo}–${zsData.bin_hi - 1}` : '—'} color="#c46bff" />
          <StatCard label="Frames" value={zsData.num_frames} color="#4d9fff" />
        </div>
      )}

      {/* PLOT */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>

        {mode === 'freq' && <>
          {noFile && <Center><Msg>NO FILE LOADED</Msg></Center>}
          {!noFile && fsError && <Center><Msg c="#ff4d6d">ERROR: {fsError}</Msg><Retry onClick={fetchFreqSpan} /></Center>}
          {fsLoading && !fsTraces.length && !fsError && !noFile && <Spin />}
          {fsHasData && <Plot data={fsTraces} layout={fsLayout} revision={revision}
            config={{ displayModeBar: true, displaylogo: false, responsive: false, scrollZoom: true }}
            style={{ position: 'absolute', inset: 0 }} onClick={handleFreqClick} />}
        </>}

        {mode === 'zero' && <>
          {noFileZero && <Center><Msg>NO FILE LOADED</Msg></Center>}
          {!noFileZero && zsState === 'stopped' && !zsData && !zsError && !zsLoading && (
            <Center><Msg c="#3a5070">PRESS ▶ RUN  · or move the position bar to preview</Msg></Center>
          )}
          {!noFileZero && zsError && (
            <Center><Msg c="#ff4d6d">ERROR: {zsError}</Msg><Retry onClick={zs_start} /></Center>
          )}
          {zsLoading && !zsHasData && !zsError && <Spin />}
          {zsHasData && (
            <Plot data={zsTraces} layout={zsLayout} revision={revision}
              config={{ displayModeBar: true, displaylogo: false, responsive: false, scrollZoom: true }}
              style={{ position: 'absolute', inset: 0 }} />
          )}
        </>}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
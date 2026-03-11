import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import SpectrumChart from './components/SpectrumChart';
import IQTimeSeriesChart from './components/IQTimeSeriesChart';
import ConstellationChart from './components/ConstellationChart';
import SpectrogramChart from './components/SpectrogramChart';
import CfarChart from './components/CfarChart';
import FilterResponseChart from './components/FilterResponseChart';
import DoaChart from './components/DoaChart';

const BASE = '';

const Label = ({ children }) => (
  <div style={{ fontSize: 10, color: '#4a5a7a', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 5, fontFamily: 'monospace' }}>{children}</div>
);

const SInput = ({ value, onChange, onBlur, type = 'text', min, max, step, style = {} }) => {
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => { setLocalValue(value); }, [value]);
  const handleChange = (e) => { const val = e.target.value; setLocalValue(val); if (val !== '') onChange(e); };
  const handleBlur = (e) => { if (localValue === '') setLocalValue(value); if (onBlur) onBlur(e); };
  return (
    <input type={type} value={localValue} onChange={handleChange} onBlur={handleBlur} min={min} max={max} step={step}
      style={{ width: '100%', background: '#080c18', border: '1px solid #1e2a3a', color: '#00d4ff', padding: '5px 8px', fontSize: 11, outline: 'none', fontFamily: 'monospace', borderRadius: 3, boxSizing: 'border-box', ...style }} />
  );
};

const SCombo = ({ value, onChange, onBlur, options, id, style = {} }) => {
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => { setLocalValue(value); }, [value]);
  const handleChange = (e) => { const val = e.target.value; setLocalValue(val); if (val !== '') onChange({ target: { value: val } }); };
  const handleBlur = (e) => { if (localValue === '') setLocalValue(value); if (onBlur) onBlur(e); };
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input list={id} value={localValue} onChange={handleChange} onBlur={handleBlur} onFocus={(e) => e.target.select()}
        style={{ width: '100%', background: '#080c18', border: '1px solid #1e2a3a', color: '#00d4ff', padding: '5px 8px', fontSize: 11, outline: 'none', fontFamily: 'monospace', borderRadius: 3, boxSizing: 'border-box', ...style }} />
      <datalist id={id}>
        {options.map(o => { const v = o.value ?? o; const l = o.label ?? String(v); return <option key={v} value={v}>{l}</option>; })}
      </datalist>
    </div>
  );
};

const SSelect = ({ value, onChange, options }) => (
  <select value={value} onChange={onChange} style={{ width: '100%', background: '#080c18', border: '1px solid #1e2a3a', color: '#00d4ff', padding: '5px 8px', fontSize: 11, outline: 'none', fontFamily: 'monospace', borderRadius: 3, cursor: 'pointer' }}>
    {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
);

const SCheckbox = ({ checked, onChange, label }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: checked ? '#00d4ff' : '#5a6a8a', fontFamily: 'monospace', userSelect: 'none' }} onClick={onChange}>
    <div style={{ width: 14, height: 14, border: `1px solid ${checked ? '#00d4ff' : '#2a3a5a'}`, background: checked ? 'rgba(0,212,255,0.15)' : 'transparent', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {checked && <div style={{ width: 7, height: 7, background: '#00d4ff', borderRadius: 1 }} />}
    </div>
    {label}
  </label>
);

const Divider = () => <div style={{ height: 1, background: '#0f1520', margin: '10px 0' }} />;

const SidebarSection = ({ title, expanded, onToggle, children }) => (
  <div style={{ borderBottom: '1px solid #0f1520' }}>
    <div onClick={onToggle} style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', background: '#090d1a' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#4a5a7a', textTransform: 'uppercase', fontFamily: 'monospace' }}>{title}</span>
      <span style={{ color: '#2a3a5a', fontSize: 9, display: 'inline-block', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▼</span>
    </div>
    {expanded && <div style={{ padding: '12px 14px' }}>{children}</div>}
  </div>
);

const NavBtn = ({ label, onClick }) => (
  <button onClick={onClick} style={{ flex: 1, padding: '5px 0', background: '#090d1a', border: '1px solid #1a2535', color: '#4a6a8a', cursor: 'pointer', fontSize: 10, borderRadius: 3, fontFamily: 'monospace' }}>{label}</button>
);

export const FILE_COLORS = ['#00d4ff', '#ff6b8a', '#5ade9a', '#ffc046', '#c46bff', '#ff9a3c', '#4af0e0', '#ff4d6d'];

export default function App() {
  const [activeTab, setActiveTab] = useState('Spectrum');
  const [files, setFiles] = useState([]);
  const [currentFile, setCurrentFile] = useState(null);
  const [fileInfo, setFileInfo] = useState({});
  const [positionPct, setPositionPct] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareFiles, setCompareFiles] = useState([]);
  const [applying, setApplying] = useState(false);
  const dspRef = useRef();
  const [dspVersion, setDspVersion] = useState(0);

  // ── FIX: lift zsWindowMs up so positionMs clamp uses the correct window ──
  const [zsWindowMs, setZsWindowMs] = useState(100.0);

  const [sections, setSections] = useState({
    global: true, mixer: false, filter: false, input: false,
    output: true, compare: false, spectrogram: false, cfar: false, doa: false
  });

  const [dsp, setDsp] = useState({
    fs_mhz: 10, analysis_window_ms: 10, fft_size: 1024,
    use_mixer: false, lo_freq_mhz: 0.0,
    use_lpf: false, lpf_taps: 101, lpf_window: 'hamming', cutoff_auto: true, cutoff_mhz: 1.0,
    bin_dtype: 'auto', hex_signed: true, q15_format: false, decimation: 1,
    cfar_guard: 4, cfar_ref: 20, cfar_threshold: 20,
    doa_spacing: 0.5, doa_rows: 1, doa_cols: 4, doa_mode: 'ULA',
  });

  const D = (key, val) => {
    setDsp(prev => { const next = { ...prev, [key]: val }; dspRef.current = next; return next; });
  };
  useEffect(() => { dspRef.current = dsp; }, [dsp]);

  const toggleSection = (id) => setSections(prev => ({ ...prev, [id]: !prev[id] }));
  const effFs = (dsp.fs_mhz / dsp.decimation).toFixed(4);
  const currentDuration = fileInfo[currentFile]?.duration_ms || 1000;
  const windowMs = dsp.analysis_window_ms;

  const positionMs = Math.min(
    Math.max(0, (positionPct / 100) * currentDuration),
    currentDuration
  );
  const refreshFileInfo = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/files`);
      const list = await res.json();
      if (!Array.isArray(list)) return;
      setFileInfo(prev => {
        const next = { ...prev };
        list.forEach(f => {
          if (next[f.dataset_id]) {
            next[f.dataset_id] = {
              ...next[f.dataset_id],
              duration_ms: f.duration_ms ?? next[f.dataset_id].duration_ms,
              total_samples: f.total_samples ?? next[f.dataset_id].total_samples,
            };
          }
        });
        return next;
      });
    } catch (e) { console.error('refreshFileInfo failed:', e); }
  }, []);

  const applyDsp = useCallback(async (overrides = {}) => {
    setApplying(true);
    const m = { ...dspRef.current, ...overrides };
    try {
      await fetch(`${BASE}/api/dsp/params`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fs_mhz: m.fs_mhz, decimation: m.decimation,
          use_lpf: m.use_lpf, lpf_taps: m.lpf_taps, lpf_window: m.lpf_window,
          cutoff_auto: m.cutoff_auto, cutoff_mhz: m.cutoff_mhz,
          use_mixer: m.use_mixer, lo_freq_mhz: m.lo_freq_mhz,
          cfar_guard: m.cfar_guard, cfar_ref: m.cfar_ref, cfar_threshold: m.cfar_threshold,
          doa_rows: m.doa_rows, doa_cols: m.doa_cols, doa_spacing: m.doa_spacing, doa_mode: m.doa_mode,
        }),
      });
      // Refresh sidebar duration display — it depends on fs which may have changed
      await refreshFileInfo();
    } catch (e) { console.error("DSP Apply Failed:", e); }
    finally { setDspVersion(v => v + 1); setTimeout(() => setApplying(false), 500); }
  }, [refreshFileInfo]);

  const handleClearAll = async () => {
    if (!window.confirm("Clear all datasets?")) return;
    try {
      await fetch(`${BASE}/api/clear`, { method: 'POST' });
      setFiles([]); setFileInfo({}); setCurrentFile(null); setCompareFiles([]); setPositionPct(0);
    } catch (e) { console.error("Clear failed:", e); }
  };


  const uploadFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(`Uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('fs_mhz', dspRef.current?.fs_mhz ?? dsp.fs_mhz);
    fd.append('bin_dtype', dsp.bin_dtype);
    fd.append('hex_signed', dsp.hex_signed);
    fd.append('q15_format', dsp.q15_format);

    try {
      const res = await fetch(`${BASE}/api/load`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.error) { setUploadError(`Load failed: ${data.error}`); return; }
      if (!data.dataset_id) { setUploadError('Load failed: no dataset_id returned'); return; }

      // ── Multi-channel CSV (e.g. Vivado ILA export) ─────────────────────
      if (data.multi_channel && Array.isArray(data.channels)) {
        const newIds = data.channels.map(ch => ch.dataset_id);
        setFiles(prev => [...prev, ...newIds]);
        setCurrentFile(newIds[0]);
        setPositionPct(0);
        setFileInfo(prev => {
          const next = { ...prev };
          data.channels.forEach(ch => {
            next[ch.dataset_id] = {
              duration_ms: ch.duration_ms || 0,
              total_samples: ch.total_samples || 0,
              data_format: ch.data_format || '',
            };
          });
          return next;
        });
        setCompareMode(true);
        setCompareFiles(newIds);
        await applyDsp();
        return;
      }

      // ── Single-channel / binary / hex (original behaviour) ────────────
      const id = data.dataset_id;
      setFiles(prev => [...prev, id]);
      setCurrentFile(id);
      setPositionPct(0);
      setFileInfo(prev => ({
        ...prev,
        [id]: {
          duration_ms: data.duration_ms || 0,
          total_samples: data.total_samples || 0,
          data_format: data.data_format || ''
        }
      }));
      await applyDsp();
    } catch (err) {
      setUploadError(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setFileInputKey(k => k + 1);  // ← KEY FIX: remount input so same file can be re-selected
    }
  };


  const handleRemoveFile = useCallback((id) => {
    fetch(`${BASE}/api/remove/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => { });
    setFiles(prev => { const next = prev.filter(f => f !== id); if (currentFile === id) { setCurrentFile(next[0] || null); setPositionPct(0); } return next; });
    setCompareFiles(prev => prev.filter(f => f !== id));
    setFileInfo(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, [currentFile]);

  const toggleCompareFile = (id) => setCompareFiles(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  const stepPos = (d) => setPositionPct(prev => Math.min(100, Math.max(0, parseFloat(prev) + d)));

  useEffect(() => {
    if (activeTab === 'DoA Estimator') setSections(prev => ({ ...prev, doa: true }));
  }, [activeTab]);

  const tabs = ['IQ Time Series', 'Spectrum', 'Constellation', 'Spectrogram', 'CFAR', 'Filter Response', 'DoA Estimator'];
  const activeCompareIds = useMemo(
    () => compareMode && compareFiles.length > 0 ? compareFiles : (currentFile ? [currentFile] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareMode, JSON.stringify(compareFiles), currentFile]
  );

  const baseProps = useMemo(() => ({
    activeDatasetId: currentFile,
    positionMs,
    windowMs,
    dspVersion,
    compareMode,
    compareIds: activeCompareIds,
    fileColors: FILE_COLORS,
    fileOrder: files,
    fftSize: dsp.fft_size,
  }), [currentFile, positionMs, windowMs, dspVersion, compareMode, activeCompareIds, files, dsp.fft_size]);

  // ── FIX: pass zsWindowMs and its setter into SpectrumChart ───────────────
  const spectrumProps = useMemo(() => ({
    ...baseProps,
    onRemoveFile: handleRemoveFile,
    zsWindowMs,
    onZsWindowChange: setZsWindowMs,
  }), [baseProps, handleRemoveFile, zsWindowMs]);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#080c18', color: '#c8d8f0', fontFamily: '"Segoe UI",sans-serif', overflow: 'hidden' }}>
      <style>{`
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      {/* ── SIDEBAR ── */}
      <aside style={{ width: 252, background: '#0a0e1a', borderRight: '1px solid #0f1520', display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid #0f1520', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '2px', color: '#e2e8f0', fontFamily: 'monospace' }}>RF ANALYZER</span>
          <span style={{ fontSize: 10, color: '#00d4ff', fontFamily: 'monospace' }}>v1.1</span>
        </div>

        {/* Files */}
        <div style={{ padding: '11px 14px', borderBottom: '1px solid #0f1520' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <Label>Data Files</Label>
            {files.length > 0 && <span onClick={handleClearAll} style={{ fontSize: 9, color: '#ff4d6d', cursor: 'pointer', fontWeight: 700, letterSpacing: '0.05em' }}>CLEAR ALL</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
            <label style={{ flex: 1, textAlign: 'center', padding: '6px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', background: uploading ? '#1a2535' : '#00d4ff', color: uploading ? '#4a6a8a' : '#080c18', cursor: 'pointer', borderRadius: 3, fontFamily: 'monospace' }}>
              {uploading ? 'LOADING…' : '+ ADD FILE'}
              <input key={fileInputKey} type="file" hidden onChange={uploadFile} disabled={uploading} />
            </label>
            {currentFile && <button onClick={() => handleRemoveFile(currentFile)} style={{ padding: '6px 10px', background: 'transparent', border: '1px solid #2a3a5a', color: '#ff4d6d', cursor: 'pointer', fontSize: 10, borderRadius: 3, fontFamily: 'monospace' }}>✕</button>}
          </div>
          {uploadError && (
            <div style={{ fontSize: 9, color: '#ff4d6d', fontFamily: 'monospace', background: 'rgba(255,77,109,0.08)', border: '1px solid rgba(255,77,109,0.25)', borderRadius: 3, padding: '5px 7px', marginBottom: 4, lineHeight: 1.4, wordBreak: 'break-word' }}>
              ⚠ {uploadError}
              <span onClick={() => setUploadError(null)} style={{ float: 'right', cursor: 'pointer', opacity: 0.6 }}>✕</span>
            </div>
          )}
          {uploadProgress && !uploadError && (
            <div style={{ fontSize: 9, color: '#5ab4d4', fontFamily: 'monospace', background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 3, padding: '5px 7px', marginBottom: 4, lineHeight: 1.4 }}>
              ⌛ {uploadProgress}
            </div>
          )}
          <div style={{ minHeight: 30, background: '#080c18', border: '1px solid #0f1520', borderRadius: 3, padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {files.length === 0
              ? <span style={{ fontSize: 10, color: '#2a3a52', fontFamily: 'monospace', lineHeight: '20px' }}>No files loaded</span>
              : files.map((f, idx) => {
                const isActive = f === currentFile;
                const inCompare = compareFiles.includes(f);
                const color = FILE_COLORS[idx % FILE_COLORS.length];
                return (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 5px', borderRadius: 3, cursor: 'pointer', background: isActive ? 'rgba(0,212,255,0.07)' : 'transparent', border: `1px solid ${isActive ? 'rgba(0,212,255,0.2)' : 'transparent'}` }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, opacity: compareMode ? 1 : 0.35 }} onClick={() => compareMode && toggleCompareFile(f)} />
                    {compareMode && <input type="checkbox" checked={inCompare} onChange={() => toggleCompareFile(f)} style={{ accentColor: color, cursor: 'pointer', flexShrink: 0 }} />}
                    <span onClick={() => { setCurrentFile(f); setPositionPct(0); }} style={{ fontSize: 10, fontFamily: 'monospace', flex: 1, overflow: 'hidden', minWidth: 0 }}>
                      <div style={{ color: isActive ? '#00d4ff' : '#5a6a8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</div>
                      {fileInfo[f]?.data_format && <div style={{ fontSize: 8, color: '#3a5070', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileInfo[f].data_format}</div>}
                    </span>
                    <button onClick={() => handleRemoveFile(f)} style={{ background: 'none', border: 'none', color: '#3a4a6a', cursor: 'pointer', fontSize: 10, padding: '0 2px', flexShrink: 0 }}>✕</button>
                  </div>
                );
              })
            }
          </div>
          <div style={{ marginTop: 7 }}>
            <SCheckbox checked={compareMode} label="Compare Mode" onChange={() => { setCompareMode(v => !v); if (!compareMode && currentFile) setCompareFiles([currentFile]); }} />
          </div>
          {compareMode && files.length > 0 && <div style={{ fontSize: 9, color: '#3a5a7a', fontFamily: 'monospace', marginTop: 4 }}>{compareFiles.length} file{compareFiles.length !== 1 ? 's' : ''} selected for overlay</div>}
        </div>

        {/* Position */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #0f1520' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Label>Position</Label>
            <div style={{ display: 'flex', gap: 8, fontSize: 10, fontFamily: 'monospace' }}>
              <span style={{ color: '#5a6a8a' }}>{parseFloat(positionPct).toFixed(1)}%</span>
              <span style={{ color: '#00d4ff' }}>{positionMs.toFixed(1)} ms</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 3, marginBottom: 7 }}>
            <NavBtn label="⏮" onClick={() => setPositionPct(0)} />
            <NavBtn label="◀◀" onClick={() => stepPos(-10)} />
            <NavBtn label="◀" onClick={() => stepPos(-1)} />
            <NavBtn label="▶" onClick={() => stepPos(1)} />
            <NavBtn label="▶▶" onClick={() => stepPos(10)} />
            <NavBtn label="⏭" onClick={() => setPositionPct(100)} />
          </div>
          <input type="range" min={0} max={100} step={0.1} value={positionPct} onChange={e => setPositionPct(e.target.value)} style={{ width: '100%', accentColor: '#00d4ff', display: 'block' }} />
          {fileInfo[currentFile] && (
            <div style={{ fontSize: 10, color: '#3a4a6a', fontFamily: 'monospace', marginTop: 4 }}>
              Duration: {(fileInfo[currentFile].duration_ms / 1000).toFixed(2)}s · {fileInfo[currentFile].total_samples?.toLocaleString()} samples
            </div>
          )}
        </div>

        {activeTab === 'DoA Estimator' && (
          <SidebarSection title="DoA Config (REQUIRED)" expanded={sections.doa} onToggle={() => toggleSection('doa')}>
            <div style={{ marginBottom: 12 }}>
              <Label>Array Type</Label>
              <SSelect value={dsp.doa_mode} onChange={e => D('doa_mode', e.target.value)} options={[{ value: 'ULA', label: '1D ULA' }, { value: 'RECT', label: '2D Rectangular' }]} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <Label>Element Spacing (λ)</Label>
              <SCombo id="sidebar-doa-spacing" value={dsp.doa_spacing} onChange={e => D('doa_spacing', parseFloat(e.target.value))} onBlur={() => applyDsp()} options={[0.25, 0.4, 0.5, 0.6, 0.75, 1.0].map(v => ({ value: v, label: `${v}λ` }))} />
            </div>
            {dsp.doa_mode === 'RECT' ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><Label>Rows (N)</Label><SCombo id="sidebar-doa-rows" value={dsp.doa_rows} onChange={e => D('doa_rows', parseInt(e.target.value))} onBlur={() => applyDsp()} options={[1, 2, 4, 8]} /></div>
                <div style={{ flex: 1 }}><Label>Cols (M)</Label><SCombo id="sidebar-doa-cols" value={dsp.doa_cols} onChange={e => D('doa_cols', parseInt(e.target.value))} onBlur={() => applyDsp()} options={[1, 2, 4, 8, 16]} /></div>
              </div>
            ) : (
              <div style={{ fontSize: 10, color: '#5a7090', padding: '10px 0', border: '1px solid #141c2e', borderRadius: 3, textAlign: 'center', marginBottom: 10 }}>1D ULA: Geometry fixed by selected files</div>
            )}
            <button onClick={() => applyDsp()} style={{ width: '100%', marginTop: 12, padding: '7px 0', background: '#00d4ff15', border: '1px solid #00d4ff', color: '#00d4ff', cursor: 'pointer', fontSize: 10, fontWeight: 700, borderRadius: 3, fontFamily: 'monospace' }}>▶ RUN DOA ESTIMATOR</button>
            <Divider />
          </SidebarSection>
        )}

        <SidebarSection title="Global Settings" expanded={sections.global} onToggle={() => toggleSection('global')}>
          <div style={{ marginBottom: 10 }}><Label>Sampling Freq (MHz)</Label><SCombo id="sidebar-fs" value={dsp.fs_mhz} step={0.001} min={0.001} onChange={e => D('fs_mhz', parseFloat(e.target.value) || 0)} onBlur={() => applyDsp()} options={[1, 2, 5, 10, 20.48, 30.72, 32.768, 40, 61.44, 122.88].map(v => ({ value: v, label: `${v} MHz` }))} /></div>
          <div style={{ marginBottom: 10 }}><Label>Analysis Window</Label><SCombo value={dsp.analysis_window_ms} id="sidebar-window" onChange={e => D('analysis_window_ms', Number(e.target.value))} onBlur={() => applyDsp()} options={[1, 2, 5, 10, 20, 50, 100].map(v => ({ value: v, label: `${v} ms` }))} /></div>
          <div><Label>FFT Size</Label><SCombo value={dsp.fft_size} id="global-opts-fft" onChange={e => { const v = Number(e.target.value); D('fft_size', v); }} onBlur={() => applyDsp()} options={[256, 512, 1024, 2048, 4096, 8192, 16384]} /></div>
        </SidebarSection>

        <SidebarSection title="Frequency Mixer" expanded={sections.mixer} onToggle={() => toggleSection('mixer')}>
          <div style={{ marginBottom: 10 }}><SCheckbox checked={dsp.use_mixer} label="Enable Mixer (Shift)" onChange={() => { const v = !dsp.use_mixer; D('use_mixer', v); applyDsp({ use_mixer: v }); }} /></div>
          <div><Label>LO Freq (MHz)</Label><SCombo id="sidebar-mixer-lo" value={dsp.lo_freq_mhz} onChange={e => D('lo_freq_mhz', parseFloat(e.target.value) || 0)} onBlur={() => applyDsp()} style={{ color: dsp.use_mixer ? '#00d4ff' : '#3a4a6a' }} options={[-10, -5, -2, -1, 0, 1, 2, 5, 10].map(v => ({ value: v, label: `${v} MHz` }))} /></div>
          {dsp.use_mixer && <div style={{ marginTop: 8, fontSize: 10, color: '#5a9a6a', fontFamily: 'monospace' }}>● ACTIVE · {dsp.lo_freq_mhz} MHz</div>}
        </SidebarSection>

        <SidebarSection title="Low-Pass Filter" expanded={sections.filter} onToggle={() => toggleSection('filter')}>
          <div style={{ marginBottom: 10 }}><SCheckbox checked={dsp.use_lpf} label="Enable AA Filter" onChange={() => { const v = !dsp.use_lpf; D('use_lpf', v); applyDsp({ use_lpf: v }); }} /></div>
          <Divider />
          <div style={{ marginBottom: 10 }}><Label>Filter Taps</Label><SCombo id="sidebar-lpf-taps" value={dsp.lpf_taps} onChange={e => D('lpf_taps', Number(e.target.value) || 101)} onBlur={() => applyDsp()} options={[31, 51, 101, 201, 301, 401, 501, 1001]} /></div>
          <div style={{ marginBottom: 10 }}><Label>Window</Label><SSelect value={dsp.lpf_window} onChange={e => { D('lpf_window', e.target.value); applyDsp({ lpf_window: e.target.value }); }} options={['hamming', 'blackman', 'hanning', 'bartlett', 'flattop']} /></div>
          <div style={{ marginBottom: 8 }}><SCheckbox checked={dsp.cutoff_auto} label="Auto Cutoff" onChange={() => { const v = !dsp.cutoff_auto; D('cutoff_auto', v); applyDsp({ cutoff_auto: v }); }} /></div>
          <div><Label>Cutoff (MHz)</Label><SCombo id="sidebar-lpf-cutoff" value={dsp.cutoff_mhz} step={0.01} min={0.001} style={{ color: !dsp.cutoff_auto ? '#00d4ff' : '#3a4a6a' }} onChange={e => D('cutoff_mhz', parseFloat(e.target.value) || 0)} onBlur={() => applyDsp()} options={[0.5, 1.0, 2.0, 4.0, 8.0, 16.0].map(v => ({ value: v, label: `${v} MHz` }))} /></div>
        </SidebarSection>

        <SidebarSection title="Input Config" expanded={sections.input} onToggle={() => toggleSection('input')}>
          <div style={{ marginBottom: 10 }}><Label>Bin Type</Label><SSelect value={dsp.bin_dtype} onChange={e => D('bin_dtype', e.target.value)} options={[{ value: 'auto', label: 'Auto (detect)' }, 'complex64', 'complex128', 'int16', 'int8', 'uint8', 'float32']} /></div>
          <div style={{ marginBottom: 8 }}><SCheckbox checked={dsp.hex_signed} label="Interpret as Signed" onChange={() => D('hex_signed', !dsp.hex_signed)} /></div>
          <div><SCheckbox checked={dsp.q15_format} label="Q15 Normalization" onChange={() => D('q15_format', !dsp.q15_format)} /></div>
        </SidebarSection>

        <SidebarSection title="CFAR Config" expanded={sections.cfar} onToggle={() => toggleSection('cfar')}>
          <div style={{ marginBottom: 10 }}><Label>FFT Size</Label><SCombo id="cfar-opts-fft-size" value={dsp.fft_size} onChange={e => D('fft_size', Number(e.target.value) || 256)} onBlur={() => applyDsp()} options={[256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]} /></div>
          <div style={{ marginBottom: 10 }}><Label>Guard Cells</Label><SCombo id="cfar-guard-opts" value={dsp.cfar_guard} onChange={e => D('cfar_guard', Number(e.target.value) || 0)} onBlur={() => applyDsp()} options={[0, 2, 4, 8, 12, 16]} /></div>
          <div style={{ marginBottom: 10 }}><Label>Ref Cells</Label><SCombo id="cfar-ref-opts" value={dsp.cfar_ref} onChange={e => D('cfar_ref', Number(e.target.value) || 20)} onBlur={() => applyDsp()} options={[8, 16, 20, 32, 64]} /></div>
          <div style={{ marginBottom: 10 }}><Label>Threshold (dB)</Label><SCombo id="cfar-thresh-opts" value={dsp.cfar_threshold} onChange={e => D('cfar_threshold', parseFloat(e.target.value))} onBlur={() => applyDsp()} options={[5, 10, 15, 20, 25, 30, 40].map(v => ({ value: v, label: `${v} dB` }))} /></div>
        </SidebarSection>

        <SidebarSection title="Output & Analysis" expanded={sections.output} onToggle={() => toggleSection('output')}>
          <div style={{ marginBottom: 10 }}><Label>Decimation</Label><SCombo value={dsp.decimation} id="sidebar-dec" onChange={e => D('decimation', Number(e.target.value))} onBlur={() => applyDsp()} options={[1, 2, 4, 8, 16, 32].map(v => ({ value: v, label: `${v}×` }))} /></div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#5a7090', marginBottom: 12 }}>Eff Fs: <span style={{ color: '#5a9a6a' }}>{effFs} MHz</span></div>
          <Divider />
          <button onClick={() => applyDsp()} style={{ width: '100%', padding: '7px 0', background: applying ? '#00d4ff22' : 'transparent', border: `1px solid #00d4ff`, color: '#00d4ff', cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', borderRadius: 3, fontFamily: 'monospace', marginBottom: 6, transition: 'all 0.2s', opacity: applying ? 0.7 : 1 }}>
            {applying ? '⌛ UPDATING...' : '⟳ APPLY & REFRESH'}
          </button>
          <button style={{ width: '100%', padding: '7px 0', background: 'transparent', border: '1px solid #1e2a3a', color: '#4a5a7a', cursor: 'pointer', fontSize: 10, letterSpacing: '0.08em', borderRadius: 3, fontFamily: 'monospace' }}>↓ EXPORT IQ</button>
        </SidebarSection>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <nav style={{ display: 'flex', background: '#0a0e1a', borderBottom: '1px solid #0f1520', overflowX: 'auto', flexShrink: 0 }}>
          {tabs.map(tab => {
            const active = activeTab === tab;
            return (
              <div key={tab} onClick={() => setActiveTab(tab)}
                style={{ padding: '11px 18px', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'monospace', letterSpacing: '0.08em', flexShrink: 0, color: active ? '#00d4ff' : '#3a4a6a', borderBottom: active ? '2px solid #00d4ff' : '2px solid transparent', background: active ? 'rgba(0,212,255,0.04)' : 'transparent', transition: 'color 0.15s' }}>
                {tab.toUpperCase()}
                {compareMode && compareFiles.length > 1 && ['Spectrum', 'IQ Time Series', 'Constellation', 'Spectrogram', 'CFAR'].includes(tab) && (
                  <span style={{ marginLeft: 5, fontSize: 8, background: 'rgba(0,212,255,0.15)', color: '#00d4ff', padding: '1px 4px', borderRadius: 2 }}>CMP</span>
                )}
              </div>
            );
          })}
        </nav>

        {compareMode && (
          <div style={{ background: 'rgba(0,212,255,0.04)', borderBottom: '1px solid rgba(0,212,255,0.1)', padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: '#00d4ff', fontFamily: 'monospace', letterSpacing: '0.08em' }}>⊕ COMPARE MODE</span>
            <span style={{ fontSize: 10, color: '#5a7090', fontFamily: 'monospace' }}>{compareFiles.length} file{compareFiles.length !== 1 ? 's' : ''} overlaid</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {compareFiles.map((f) => (
                <span key={f} style={{ fontSize: 9, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 2, background: `${FILE_COLORS[files.indexOf(f) % FILE_COLORS.length]}22`, color: FILE_COLORS[files.indexOf(f) % FILE_COLORS.length], border: `1px solid ${FILE_COLORS[files.indexOf(f) % FILE_COLORS.length]}44` }}>
                  {f.length > 18 ? f.slice(0, 16) + '…' : f}
                </span>
              ))}
            </div>
            <button onClick={() => setCompareMode(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#5a7090', cursor: 'pointer', fontSize: 11 }}>✕</button>
          </div>
        )}

        <section style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: activeTab === 'Spectrum' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <SpectrumChart {...spectrumProps} />
          </div>

          {activeTab === 'IQ Time Series' && <IQTimeSeriesChart  {...baseProps} />}
          {activeTab === 'Constellation' && <ConstellationChart  {...baseProps} />}
          {activeTab === 'Spectrogram' && <SpectrogramChart    {...baseProps} />}
          {activeTab === 'CFAR' && <CfarChart           {...baseProps} cfarFft={dsp.fft_size} guardCells={dsp.cfar_guard} refCells={dsp.cfar_ref} thresholdDb={dsp.cfar_threshold} />}
          {activeTab === 'Filter Response' && <FilterResponseChart dspVersion={dspVersion} lpfEnabled={dsp.use_lpf} />}
          {activeTab === 'DoA Estimator' && <DoaChart            {...baseProps} />}
        </section>
      </main>
    </div>
  );
}
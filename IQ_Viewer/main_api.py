import os
import tempfile
import numpy as np
from fastapi import FastAPI, UploadFile, File, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from typing import List, Optional
from pydantic import BaseModel
import uvicorn

from data_loader import DataLoader
from data_manager import DataManager
from dsp_processing import DSPProcessor

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

data_manager = DataManager()


# ── Global exception handler so the .exe never returns a raw 500 ──────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": f"Internal server error: {type(exc).__name__}: {exc}"},
    )


def _compute_frame_psd(frame: np.ndarray, fft_size: int, eff_fs: float) -> np.ndarray:
    """
    Compute power spectrum of one frame in dBFS.

    Amplitude-coherent window normalisation: win / sum(win)
    → |X[peak_bin]| == signal amplitude for a pure tone → 0 dBFS = full scale.
    """
    win      = np.hanning(fft_size)
    win_norm = win / np.sum(win)
    X        = np.fft.fftshift(np.fft.fft(frame * win_norm, n=fft_size))
    return 20 * np.log10(np.abs(X) + 1e-20)

def _sanitize(arr):
    """Replace nan/inf with 0 so JSON serialization never crashes."""
    return np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=-200.0)


# ── File Management ────────────────────────────────────────────────────────

@app.post("/api/clear")
def clear_all_datasets():
    data_manager.clear_all()
    return {"status": "ok"}


@app.post("/api/load")
async def load_file(
    file: UploadFile = File(...),
    fs_mhz: float = 10.0,
    bin_dtype: str = "auto",
    hex_signed: bool = True,
    q15_format: bool = False,
    scale_factor: float = 1.0,
    channel_mode: str = "auto",
    max_samples: int = 0,
):
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix if suffix else '.tmp') as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = DataLoader.load_file(
            tmp_path,
            max_samples=max_samples if max_samples > 0 else None,
            channel_mode_var=channel_mode,
            hex_signed=hex_signed,
            scale_factor=scale_factor,
            q15_format=q15_format,
            bin_dtype=bin_dtype,
        )
    except Exception as e:
        return {"error": f"Loader exception: {type(e).__name__}: {e}"}
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    if result is None:
        return {"error": "Failed to load file — format not recognised or file is empty"}

    # ── Multi-channel ILA CSV ─────────────────────────────────────────────
    if isinstance(result, list):
        loaded = []
        for item in result:
            if len(item) != 5:
                continue
            signal, data_format, mode_detected, raw_hex, ch_name = item
            if signal is None or len(signal) == 0:
                continue
            base_id    = f"{file.filename}:{ch_name}"
            dataset_id = base_id
            count = 1
            while dataset_id in data_manager.datasets:
                dataset_id = f"{base_id} ({count})"
                count += 1

            data_manager.set_data(
                dataset_id, signal, fs_mhz * 1e6,
                data_format, channel_mode=mode_detected,
                is_memmap=False, raw_hex_data=raw_hex,
            )
            info = data_manager.get_info(dataset_id)
            loaded.append({
                "dataset_id":    dataset_id,
                "channel":       ch_name,
                "total_samples": info["total_samples"],
                "duration_ms":   info["duration_ms"],
                "sampling_freq": info["sampling_freq"],
                "data_format":   data_format,
            })

        if not loaded:
            return {"error": "No channels could be loaded from file"}

        return {
            "multi_channel": True,
            "channels":      loaded,
            "dataset_id":    loaded[0]["dataset_id"],
            "total_samples": loaded[0]["total_samples"],
            "duration_ms":   loaded[0]["duration_ms"],
            "sampling_freq": loaded[0]["sampling_freq"],
            "data_format":   loaded[0]["data_format"],
        }

    # ── Single-signal path ────────────────────────────────────────────────
    if not isinstance(result, tuple) or len(result) != 4:
        return {"error": f"Unexpected loader result type: {type(result)}"}

    signal, data_format, mode_detected, raw_hex = result

    if signal is None:
        return {"error": "Failed to load file — loader returned no signal"}

    if len(signal) == 0:
        return {"error": "File loaded but contained 0 samples — check file format and content"}

    dataset_id = file.filename
    count      = 1
    existing   = list(data_manager.datasets.keys())
    while dataset_id in existing:
        dataset_id = f"{file.filename} ({count})"
        count += 1

    is_mem_map = isinstance(signal, np.memmap)
    data_manager.set_data(
        dataset_id, signal, fs_mhz * 1e6,
        data_format, channel_mode=mode_detected,
        is_memmap=is_mem_map, raw_hex_data=raw_hex,
    )

    info = data_manager.get_info(dataset_id)
    return {
        "dataset_id":    dataset_id,
        "total_samples": info["total_samples"],
        "duration_ms":   info["duration_ms"],
        "sampling_freq": info["sampling_freq"],
        "data_format":   data_format,
    }


@app.delete("/api/remove/{dataset_id}")
def remove_file(dataset_id: str):
    data_manager.remove_dataset(dataset_id)
    return {"ok": True}


@app.get("/api/files")
def list_files():
    result = []
    for ds_id in data_manager.datasets:
        info = data_manager.get_info(ds_id)
        result.append({"dataset_id": ds_id, **info})
    return result


# ── DSP Parameters ─────────────────────────────────────────────────────────

class DSPParams(BaseModel):
    fs_mhz:         float = 10.0
    decimation:     int   = 1
    use_lpf:        bool  = False
    lpf_taps:       int   = 101
    lpf_window:     str   = "hamming"
    cutoff_auto:    bool  = True
    cutoff_mhz:     float = 1.0
    use_mixer:      bool  = False
    lo_freq_mhz:    float = 0.0
    cfar_guard:     int   = 4
    cfar_ref:       int   = 20
    cfar_threshold: float = 20.0
    doa_rows:       int   = 1
    doa_cols:       int   = 4
    doa_spacing:    float = 0.5
    doa_mode:       str   = "ULA"


@app.post("/api/dsp/params")
def set_dsp_params(params: DSPParams):
    data_manager.update_all_fs(params.fs_mhz * 1e6)
    data_manager.set_decimation(params.decimation)
    data_manager.set_lpf_params(
        params.use_lpf, params.lpf_taps, params.lpf_window,
        params.cutoff_auto,
        params.cutoff_mhz * 1e6 if not params.cutoff_auto else None,
    )
    data_manager.set_mixer_params(params.use_mixer, params.lo_freq_mhz * 1e6)
    data_manager.set_cfar_params(params.cfar_guard, params.cfar_ref, params.cfar_threshold)
    data_manager.set_doa_params(params.doa_rows, params.doa_cols, params.doa_spacing, params.doa_mode)
    return {"ok": True}


# ── IQ Time Series ─────────────────────────────────────────────────────────

@app.get("/api/iq_timeseries")
def get_iq_timeseries(
    dataset_id:  str,
    position_ms: float = 0.0,
    window_ms:   float = 10.0,
):
    data = data_manager.get_window(position_ms, window_ms, dataset_id=dataset_id)
    if data is None or len(data) == 0:
        return {"error": "No data"}

    eff_fs = data_manager.get_effective_fs(dataset_id=dataset_id)
    MAX    = 50000
    step   = max(1, len(data) // MAX)
    t      = (np.arange(len(data)) / eff_fs * 1000.0) + position_ms
    t      = t[::step]
    data   = data[::step]

    i = _sanitize(data.real)
    q = _sanitize(data.imag)
    return {"t": t.tolist(), "i": i.tolist(), "q": q.tolist()}


# ── Spectrum ───────────────────────────────────────────────────────────────

@app.get("/api/spectrum")
def get_spectrum(
    dataset_id:     str,
    position_ms:    float = 0.0,
    window_ms:      float = 10.0,
    fft_size:       int   = 1024,
    average_frames: bool  = False,
    normalize_db:   bool  = False,
):
    data = data_manager.get_window(position_ms, window_ms, dataset_id=dataset_id)
    if data is None or len(data) < fft_size:
        return {"error": "Insufficient data"}

    eff_fs     = data_manager.get_effective_fs(dataset_id=dataset_id)
    num_frames = len(data) // fft_size

    # Remove DC offset to suppress IQ imbalance spike at 0 Hz
    data = data - np.mean(data)

    if average_frames and num_frames > 1:
        pwr_accum = np.zeros(fft_size)
        for j in range(num_frames):
            frame      = data[j * fft_size:(j + 1) * fft_size]
            pwr_accum += 10 ** (_compute_frame_psd(frame, fft_size, eff_fs) / 10)
        power_db = 10 * np.log10(pwr_accum / num_frames + 1e-20)
    else:
        power_db = _compute_frame_psd(data[:fft_size], fft_size, eff_fs)

    if normalize_db:
        power_db -= np.max(power_db)

    power_db    = _sanitize(power_db)
    freqs       = np.fft.fftshift(np.fft.fftfreq(fft_size, 1 / eff_fs)) / 1e6
    peak_idx    = int(np.argmax(power_db))
    peak_db_val = float(power_db[peak_idx])

    # Pre-filter deep LPF stopband nulls before noise estimation
    dynamic_threshold = peak_db_val - 100.0
    valid_bins        = power_db[power_db > dynamic_threshold]
    floor_clamp       = float(np.percentile(valid_bins, 5)) if len(valid_bins) > 10 else dynamic_threshold
    power_db_for_noise = np.clip(power_db, floor_clamp, 0.0)

    # Estimate noise floor
    noise_db_per_bin = DSPProcessor.estimate_noise_floor(power_db_for_noise, peak_idx, fft_size)

    # SNR = peak power minus noise floor
    # Simple, intuitive reading — what SDR users expect to see
    snr_db = peak_db_val - float(noise_db_per_bin)

    return {
        "freqs":      freqs.tolist(),
        "power_db":   power_db.tolist(),
        "peak_mhz":   float(freqs[peak_idx]),
        "peak_db":    float(power_db[peak_idx]),
        "noise_db":   float(noise_db_per_bin),
        "snr_db":     float(snr_db),
        "num_frames": num_frames,
    }


# ── Constellation ──────────────────────────────────────────────────────────

@app.get("/api/constellation")
def get_constellation(
    dataset_id:  str,
    position_ms: float = 0.0,
    window_ms:   float = 10.0,
    max_points:  int   = 30000,
    center_data: bool  = False,
):
    data = data_manager.get_window(position_ms, window_ms, dataset_id=dataset_id)
    if data is None or len(data) == 0:
        return {"error": "No data"}

    step = max(1, len(data) // max_points)
    data = data[::step]
    I, Q = data.real, data.imag
    if center_data:
        I, Q = I - np.mean(I), Q - np.mean(Q)

    return {"i": I.tolist(), "q": Q.tolist()}


# ── Spectrogram ────────────────────────────────────────────────────────────

@app.get("/api/spectrogram")
def get_spectrogram(
    dataset_id:  str,
    position_ms: float = 0.0,
    window_ms:   float = 10.0,
    fft_size:    int   = 1024,
    max_frames:  int   = 300,
):
    data = data_manager.get_window(position_ms, window_ms, dataset_id=dataset_id)
    if data is None or len(data) < fft_size:
        return {"error": "Insufficient data"}

    eff_fs     = data_manager.get_effective_fs(dataset_id=dataset_id)
    hop        = fft_size // 2
    num_frames = (len(data) - fft_size) // hop

    if num_frames <= 0:
        return {"error": "Not enough data for spectrogram"}

    step  = max(1, num_frames // max_frames)
    spec  = []
    times = []

    for i in range(0, num_frames, step):
        frame = data[i * hop: i * hop + fft_size]
        spec.append(_compute_frame_psd(frame, fft_size, eff_fs).tolist())
        times.append(position_ms + (i * hop / eff_fs) * 1000.0)

    spec = _sanitize(np.array(spec)).tolist()

    freqs = np.fft.fftshift(np.fft.fftfreq(fft_size, 1 / eff_fs)) / 1e6
    return {"spec": spec, "times": times, "freqs": freqs.tolist()}


# ── CFAR ───────────────────────────────────────────────────────────────────

@app.get("/api/cfar")
def get_cfar(
    dataset_id:   str,
    position_ms:  float           = 0.0,
    window_ms:    float           = 10.0,
    fft_size:     int             = 1024,
    guard_cells:  Optional[int]   = None,
    ref_cells:    Optional[int]   = None,
    threshold_db: Optional[float] = None,
):
    data = data_manager.get_window(position_ms, window_ms, dataset_id=dataset_id)
    if data is None or len(data) < fft_size:
        return {"error": "Insufficient data"}

    eff_fs = data_manager.get_effective_fs(dataset_id=dataset_id)
    g      = guard_cells  if guard_cells  is not None else data_manager.cfar_guard
    r      = ref_cells    if ref_cells    is not None else data_manager.cfar_ref
    thr    = threshold_db if threshold_db is not None else data_manager.cfar_threshold

    data     = data - np.mean(data)
    power_db = _compute_frame_psd(data[:fft_size], fft_size, eff_fs)
    freqs    = np.fft.fftshift(np.fft.fftfreq(fft_size, 1 / eff_fs)) / 1e6
    Nf       = len(power_db)

    kernel             = np.ones(2 * r + 2 * g + 1)
    kernel[r:r+2*g+1]  = 0
    kernel            /= (np.sum(kernel) if np.sum(kernel) > 0 else 1)

    noise_floor = np.convolve(power_db, kernel, mode='same')
    threshold   = noise_floor + thr
    mask        = np.ones(Nf, dtype=bool)
    mask[:r+g]    = False
    mask[-(r+g):] = False
    peaks = np.where((power_db > threshold) & mask)[0]

    return {
        "freqs":          freqs.tolist(),
        "power_db":       power_db.tolist(),
        "threshold":      threshold.tolist(),
        "peak_freqs":     freqs[peaks].tolist(),
        "peak_powers":    power_db[peaks].tolist(),
        "num_detections": len(peaks),
        "cfar_guard":     g,
        "cfar_ref":       r,
        "cfar_threshold": thr,
    }


# ── Filter Response ────────────────────────────────────────────────────────

@app.get("/api/filter_response")
def get_filter_response():
    if not data_manager.use_lpf or not data_manager.has_data():
        return {"error": "LPF disabled or no data"}

    fs_hz = data_manager.get_effective_fs() * data_manager.decimation
    taps  = data_manager._get_lpf_taps(fs_hz)
    if taps is None:
        return {"error": "No taps"}

    freqs, mag_db, phase_deg = DSPProcessor.get_filter_response(taps, fs_hz, 1024)
    return {
        "freqs_mhz": (freqs / 1e6).tolist(),
        "mag_db":    mag_db.tolist(),
        "phase_deg": phase_deg.tolist(),
        "num_taps":  len(taps),
        "window":    data_manager.lpf_window,
    }


# ── DoA ────────────────────────────────────────────────────────────────────

@app.get("/api/doa")
def get_doa(
    request: Request,
    position_ms: float = 0.0,
    window_ms:   float = 10.0,
):
    # Parse dataset_ids robustly from raw query string
    # Supports: ?dataset_ids=a&dataset_ids=b  AND  ?dataset_ids=a,b
    raw_ids: List[str] = []
    for val in request.query_params.getlist("dataset_ids"):
        for part in val.split(","):
            part = part.strip()
            if part:
                raw_ids.append(part)

    ids = raw_ids
    if len(ids) < 2:
        return {
            "error": (
                "DoA requires at least 2 channels. "
                "Enable Compare Mode and select multiple files."
            )
        }

    ids.sort()
    signals = [data_manager.get_window(position_ms, window_ms, dataset_id=i) for i in ids]
    signals = [s for s in signals if s is not None and len(s) > 0]
    if not signals:
        return {"error": "Insufficient data"}

    N = min(min(len(s) for s in signals), 2048)
    X = np.vstack([s[:N] for s in signals])
    M = X.shape[0]

    if N < 4 * M:
        return {
            "error": (
                f"Too few snapshots ({N}) for {M} channels. "
                f"Increase Analysis Window so N ≥ {4 * M}."
            )
        }

    rows    = data_manager.doa_rows
    cols    = data_manager.doa_cols
    spacing = data_manager.doa_spacing
    mode    = data_manager.doa_mode
    eff_fs  = data_manager.get_effective_fs(dataset_id=ids[0])

    if mode == "ULA":
        rows, cols, spacing = 1, M, 0.5
    elif rows * cols != M:
        return {
            "error": (
                f"2D Rect Layout ({rows}x{cols}) does not match "
                f"selected files ({M})."
            )
        }

    fft_size = min(1024, N)
    ref_fft  = np.fft.fftshift(np.fft.fft(X[0, :fft_size]))
    peak_bin = int(np.argmax(np.abs(ref_fft)))
    freqs_hz = np.fft.fftshift(np.fft.fftfreq(fft_size, 1 / eff_fs))
    peak_mhz = freqs_hz[peak_bin] / 1e6

    pair_info = []
    for i in range(1, M):
        ch_fft = np.fft.fftshift(np.fft.fft(X[i, :fft_size]))
        dphi   = np.angle(ch_fft[peak_bin] * np.conj(ref_fft[peak_bin]), deg=True)
        pair_info.append({"label": f"Ch0↔Ch{i}", "dphi": round(float(dphi), 1)})

    R        = (X @ X.conj().T / N) + np.eye(M) * 1e-10
    az_range = np.linspace(-90, 90, 181)
    el_range = np.linspace(0, 90, 91) if rows > 1 else np.array([0.0])

    def get_power(az_deg, el_deg):
        theta, phi = np.radians(az_deg), np.radians(el_deg)
        a = np.array([
            np.exp(1j * 2 * np.pi * spacing * (c * np.sin(theta) * np.cos(phi) + r * np.sin(phi)))
            for r in range(rows) for c in range(cols)
        ])
        return float(np.abs(a.conj().T @ R @ a))

    best_pwr, peak_az, peak_el = -1.0, 0.0, 0.0
    for el in el_range:
        for az in az_range:
            pwr = get_power(az, el)
            if pwr > best_pwr:
                best_pwr, peak_az, peak_el = pwr, az, el

    spectrum_linear = np.array([get_power(az, peak_el) for az in az_range])
    spectrum_db     = 10 * np.log10(spectrum_linear / (spectrum_linear.max() + 1e-12) + 1e-30)
    spectrum_db    -= spectrum_db.min()

    return {
        "angles":         az_range.tolist(),
        "spectrum_db":    spectrum_db.tolist(),
        "peak_az":        round(peak_az, 2),
        "peak_el":        round(peak_el, 2),
        "peak_angle_deg": round(peak_az, 2),
        "peak_mhz":       round(float(peak_mhz), 4),
        "pair_info":      pair_info,
        "phases":         [p["dphi"] for p in pair_info],
    }


# ── Zero Span ──────────────────────────────────────────────────────────────

@app.get("/api/zero_span")
def get_zero_span(
    dataset_id:       str,
    center_mhz:       float = 0.0,
    position_ms:      float = 0.0,
    zs_window_ms:     float = 100.0,
    zs_fft_size:      int   = 512,
    trigger_mode:     str   = "free",
    trigger_level_db: float = -20.0,
    dc_downconvert:   bool  = True,
):
    zs_fft_size = int(np.clip(zs_fft_size, 64, 8192))

    data = data_manager.get_window(position_ms, zs_window_ms, dataset_id=dataset_id)
    if data is None or len(data) < zs_fft_size:
        return {
            "error": (
                f"Insufficient data — need ≥ {zs_fft_size} samples. "
                "Try increasing Window (ms) or reducing FFT size."
            )
        }

    eff_fs = data_manager.get_effective_fs(dataset_id=dataset_id)

    lo_already_hz = data_manager.mixer_lo_freq_hz if data_manager.use_mixer else 0.0
    residual_hz   = center_mhz * 1e6 - lo_already_hz

    if dc_downconvert and abs(residual_hz) > 1.0:
        t    = np.arange(len(data)) / eff_fs
        data = data * np.exp(-1j * 2 * np.pi * residual_hz * t)

    hop      = zs_fft_size // 2
    n_frames = (len(data) - zs_fft_size) // hop + 1

    if n_frames <= 0:
        return {"error": "Not enough data for zero-span. Increase Window (ms)."}

    win      = np.hanning(zs_fft_size)
    win_norm = win / np.sum(win)

    freqs            = np.fft.fftshift(np.fft.fftfreq(zs_fft_size, d=1.0 / eff_fs))
    target_freq      = center_mhz * 1e6
    original_bin_idx = int(np.argmin(np.abs(freqs - target_freq)))
    bin_idx          = zs_fft_size // 2 if dc_downconvert else original_bin_idx

    half_int = 2
    bin_lo   = max(0, bin_idx - half_int)
    bin_hi   = min(zs_fft_size, bin_idx + half_int + 1)

    powers_db = []
    times_ms  = []

    for i in range(n_frames):
        start = i * hop
        frame = data[start: start + zs_fft_size]
        if len(frame) < zs_fft_size:
            break
        X    = np.fft.fftshift(np.fft.fft(frame * win_norm, n=zs_fft_size))
        band = X[bin_lo:bin_hi]
        psd_val = float(np.sum(np.abs(band) ** 2))
        powers_db.append(float(10 * np.log10(psd_val + 1e-20)))
        times_ms.append(float(position_ms + (start / eff_fs) * 1000.0))

    if not powers_db:
        return {"error": "No frames computed. Try increasing Window (ms)."}

    powers_arr = np.array(powers_db)

    triggered = True
    if trigger_mode in ("rise", "fall"):
        triggered = False
        for i in range(1, len(powers_arr)):
            if trigger_mode == "rise":
                fired = powers_arr[i - 1] < trigger_level_db <= powers_arr[i]
            else:
                fired = powers_arr[i - 1] >= trigger_level_db > powers_arr[i]

            if fired:
                triggered  = True
                t0         = times_ms[i]
                powers_arr = powers_arr[i:]
                times_ms   = [t - t0 for t in times_ms[i:]]
                break

        if not triggered:
            return {
                "triggered":   False,
                "times_ms":    [],
                "powers_db":   [],
                "rbw_hz":      float(eff_fs / zs_fft_size),
                "rbw_khz":     float(eff_fs / zs_fft_size / 1e3),
                "time_res_us": float((hop / eff_fs) * 1e6),
                "num_frames":  n_frames,
                "center_mhz":  float(center_mhz),
                "bin_idx":     int(original_bin_idx),
                "bin_lo":      int(original_bin_idx - 2),
                "bin_hi":      int(original_bin_idx + 3),
            }

    return {
        "triggered":   triggered,
        "times_ms":    times_ms,
        "powers_db":   powers_arr.tolist(),
        "rbw_hz":      float(eff_fs / zs_fft_size),
        "rbw_khz":     float(eff_fs / zs_fft_size / 1e3),
        "time_res_us": float((hop / eff_fs) * 1e6),
        "num_frames":  n_frames,
        "center_mhz":  float(center_mhz),
        "bin_idx":     int(original_bin_idx),
        "bin_lo":      int(original_bin_idx - 2),
        "bin_hi":      int(original_bin_idx + 3),
    }


# ── Serve React build ──────────────────────────────────────────────────────

import sys as _sys
if getattr(_sys, 'frozen', False):
    _base = _sys._MEIPASS
else:
    _base = os.path.dirname(os.path.abspath(__file__))
    _base = os.path.dirname(_base)

_frontend_dist = os.path.join(_base, "frontend", "dist")
if os.path.exists(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("main_api:app", host="0.0.0.0", port=8000, reload=True)
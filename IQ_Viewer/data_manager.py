import numpy as np
import threading
from dsp_processing import DSPProcessor


class DataManager:

    def __init__(self):
        self.datasets          = {}
        self.decimation        = 1
        self.selected_datasets = []
        self._lock             = threading.Lock()

        # DoA Config
        self.doa_rows    = 1
        self.doa_cols    = 4
        self.doa_spacing = 0.5
        self.doa_mode    = "ULA"

        self.use_lpf          = False
        self.lpf_taps_count   = 101
        self.lpf_window       = 'hamming'
        self.lpf_cutoff_auto  = True
        self.lpf_cutoff_hz    = None
        self.lpf_taps_cache   = {}

        self.use_mixer        = False
        self.mixer_lo_freq_hz = 0.0

        # CFAR Config
        self.cfar_guard     = 4
        self.cfar_ref       = 20
        self.cfar_threshold = 20.0

    def clear_all(self):
        with self._lock:
            self.datasets.clear()
            self.selected_datasets.clear()

    # ── DSP parameter setters ──────────────────────────────────────────────

    def set_lpf_params(self, use_lpf, taps_count, window, cutoff_auto, cutoff_hz=None):
        with self._lock:
            self.use_lpf         = use_lpf
            self.lpf_taps_count  = taps_count
            self.lpf_window      = window
            self.lpf_cutoff_auto = cutoff_auto
            self.lpf_cutoff_hz   = cutoff_hz
            self.lpf_taps_cache.clear()

    def set_mixer_params(self, use_mixer, lo_freq_hz):
        with self._lock:
            self.use_mixer        = use_mixer
            self.mixer_lo_freq_hz = lo_freq_hz

    def set_doa_params(self, rows, cols, spacing, mode="ULA"):
        with self._lock:
            self.doa_rows    = rows
            self.doa_cols    = cols
            self.doa_spacing = spacing
            self.doa_mode    = mode

    def set_cfar_params(self, guard, ref, threshold):
        with self._lock:
            self.cfar_guard     = guard
            self.cfar_ref       = ref
            self.cfar_threshold = threshold

    # ── FIX: propagate new Fs to ALL loaded datasets ───────────────────────
    def update_all_fs(self, new_fs_hz: float):
        with self._lock:
            for ds in self.datasets.values():
                ds['sampling_freq'] = new_fs_hz
            self.lpf_taps_cache.clear()

    # ── Internal: build / cache LPF taps ──────────────────────────────────
    def _get_lpf_taps_locked(self, fs_hz, decimation, use_lpf,
                              cutoff_auto, cutoff_hz, taps_count, window):
        if not use_lpf:
            return None

        if cutoff_auto:
            cutoff = (fs_hz / decimation / 2.0) * 0.8
        else:
            cutoff = cutoff_hz if cutoff_hz is not None else (fs_hz / decimation / 2.0) * 0.8

        # Safety: cutoff must be strictly less than Nyquist
        nyquist = fs_hz / 2.0
        cutoff = min(cutoff, nyquist * 0.99)

        cache_key = (fs_hz, cutoff, taps_count, window)
        if cache_key in self.lpf_taps_cache:
            return self.lpf_taps_cache[cache_key]

        taps = DSPProcessor.design_lowpass_filter(cutoff, fs_hz, taps_count, window)
        self.lpf_taps_cache[cache_key] = taps
        return taps

    # Public accessor kept for FilterResponseVisualizer compatibility
    def _get_lpf_taps(self, fs_hz):
        with self._lock:
            return self._get_lpf_taps_locked(
                fs_hz,
                self.decimation,
                self.use_lpf,
                self.lpf_cutoff_auto,
                self.lpf_cutoff_hz,
                self.lpf_taps_count,
                self.lpf_window,
            )

    # ── Core signal accessor ───────────────────────────────────────────────
    def get_window(self, start_ms, duration_ms, dataset_id=None):
        with self._lock:
            ds = self._get_ds_locked(dataset_id)
            if ds is None or ds['signal'] is None or ds['total_samples'] == 0:
                return None

            fs = ds['sampling_freq']

            decimation    = self.decimation
            use_mixer     = self.use_mixer
            lo_freq_hz    = self.mixer_lo_freq_hz
            filter_taps   = self._get_lpf_taps_locked(
                fs, decimation,
                self.use_lpf, self.lpf_cutoff_auto, self.lpf_cutoff_hz,
                self.lpf_taps_count, self.lpf_window,
            )
            filter_margin = self.lpf_taps_count if (filter_taps is not None and decimation > 1) else 0

            start_sample = int((start_ms   / 1000.0) * fs)
            window_samps = int((duration_ms / 1000.0) * fs)

            start_sample = max(0, start_sample - filter_margin)
            end_sample   = min(start_sample + window_samps + 2 * filter_margin,
                               ds['total_samples'])

            window = ds['signal'][start_sample:end_sample]

        # Heavy computation outside the lock
        if use_mixer and lo_freq_hz != 0:
            window = DSPProcessor.mix_signal(window, lo_freq_hz, fs)

        if filter_taps is not None:
            window = DSPProcessor.apply_filter(window, filter_taps)
            if filter_margin > 0 and len(window) > 2 * filter_margin:
                window = window[filter_margin:-filter_margin]

        if decimation > 1:
            window = window[::decimation]

        return window

    def get_time_axis(self, start_ms, duration_ms, dataset_id=None):
        window = self.get_window(start_ms, duration_ms, dataset_id)
        if window is None or len(window) == 0:
            return None

        eff_fs = self.get_effective_fs(dataset_id)
        t = np.arange(len(window)) / eff_fs * 1000.0 + start_ms
        return t

    # ── Dataset management ─────────────────────────────────────────────────
    def set_data(self, dataset_id, signal, sampling_freq, data_format="Unknown",
                 channel_mode="dual", is_memmap=False, raw_hex_data=None):
        with self._lock:
            self.datasets[dataset_id] = {
                'signal'       : signal,
                'total_samples': len(signal) if signal is not None else 0,
                'sampling_freq': sampling_freq,
                'data_format'  : data_format,
                'channel_mode' : channel_mode,
                'is_memmap'    : is_memmap,
                'raw_hex_data' : raw_hex_data if raw_hex_data else [],
            }
            if dataset_id not in self.selected_datasets:
                self.selected_datasets.append(dataset_id)

    def remove_dataset(self, dataset_id):
        with self._lock:
            if dataset_id in self.datasets:
                del self.datasets[dataset_id]
            if dataset_id in self.selected_datasets:
                self.selected_datasets.remove(dataset_id)

    def select_datasets(self, dataset_ids):
        with self._lock:
            self.selected_datasets = [d for d in dataset_ids if d in self.datasets]

    def set_decimation(self, decimation):
        with self._lock:
            self.decimation = max(1, int(decimation))
            self.lpf_taps_cache.clear()

    # ── Queries ────────────────────────────────────────────────────────────
    def get_effective_fs(self, dataset_id=None):
        ds = self._get_ds(dataset_id)
        if not ds:
            return 10e6 / self.decimation
        return ds['sampling_freq'] / self.decimation

    def get_duration_ms(self, dataset_id=None):
        with self._lock:
            if not self.datasets:
                return 0.0

            if dataset_id and dataset_id in self.datasets:
                ds = self.datasets[dataset_id]
                return (ds['total_samples'] / ds['sampling_freq']) * 1000.0

            current_ids = self.selected_datasets if self.selected_datasets \
                          else list(self.datasets.keys())
            max_dur = 0.0
            for d_id in current_ids:
                ds  = self.datasets[d_id]
                dur = (ds['total_samples'] / ds['sampling_freq']) * 1000.0
                max_dur = max(max_dur, dur)
            return max_dur

    def _get_ds(self, dataset_id):
        with self._lock:
            return self._get_ds_locked(dataset_id)

    def _get_ds_locked(self, dataset_id):
        if not self.datasets:
            return None
        if dataset_id and dataset_id in self.datasets:
            return self.datasets[dataset_id]
        if self.selected_datasets:
            return self.datasets.get(self.selected_datasets[0])
        return self.datasets[next(iter(self.datasets))]

    def has_data(self):
        return len(self.datasets) > 0

    def get_info(self, dataset_id=None):
        ds = self._get_ds(dataset_id)
        if not ds:
            return {}
        return {
            'total_samples': ds['total_samples'],
            'sampling_freq': ds['sampling_freq'],
            'decimation'   : self.decimation,
            'effective_fs' : ds['sampling_freq'] / self.decimation,
            'duration_ms'  : (ds['total_samples'] / ds['sampling_freq']) * 1000.0,
            'data_format'  : ds['data_format'],
            'channel_mode' : ds['channel_mode'],
            'is_memmap'    : ds['is_memmap'],
        }

    @property
    def raw_hex_data(self):
        ds = self._get_ds(None)
        return ds['raw_hex_data'] if ds else []
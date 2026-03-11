import numpy as np
from scipy import signal as scipy_signal


class DSPProcessor:
    """Digital signal processing operations"""

    @staticmethod
    def design_lowpass_filter(cutoff_hz, fs_hz, num_taps, window='hamming'):
        nyquist = fs_hz / 2.0
        normalized_cutoff = cutoff_hz / nyquist

        if normalized_cutoff >= 1.0:
            normalized_cutoff = 0.95

        if window == 'kaiser':
            beta = 5.0
            taps = scipy_signal.firwin(
                num_taps, normalized_cutoff,
                window=('kaiser', beta), pass_zero='lowpass'
            )
        else:
            taps = scipy_signal.firwin(
                num_taps, normalized_cutoff,
                window=window, pass_zero='lowpass'
            )
        return taps

    @staticmethod
    def apply_filter(sig, filter_taps):
        min_len = 3 * len(filter_taps) + 1
        if len(sig) > min_len:
            i_filtered = scipy_signal.filtfilt(filter_taps, 1.0, sig.real)
            q_filtered = scipy_signal.filtfilt(filter_taps, 1.0, sig.imag)
        else:
            # Fallback for very short windows — lfilter still works here
            i_filtered = scipy_signal.lfilter(filter_taps, 1.0, sig.real)
            q_filtered = scipy_signal.lfilter(filter_taps, 1.0, sig.imag)
        return i_filtered + 1j * q_filtered

    @staticmethod
    def decimate_signal(sig, decimation_factor, filter_taps=None):
        if decimation_factor <= 1:
            return sig
        if filter_taps is None:
            decimated = scipy_signal.decimate(sig, decimation_factor, ftype='fir')
            return decimated
        else:
            filtered = DSPProcessor.apply_filter(sig, filter_taps)
            return filtered[::decimation_factor]

    @staticmethod
    def mix_signal(sig, lo_freq_hz, fs_hz):
        n_samples = len(sig)
        t = np.arange(n_samples) / fs_hz
        mixer = np.exp(-1j * 2 * np.pi * lo_freq_hz * t)
        return sig * mixer

    @staticmethod
    def get_filter_response(filter_taps, fs_hz, num_points=512):
        w, h = scipy_signal.freqz(filter_taps, worN=num_points, fs=fs_hz)
        magnitude_db = 20 * np.log10(np.abs(h) + 1e-12)
        phase_deg = np.angle(h) * 180 / np.pi
        return w, magnitude_db, phase_deg

    @staticmethod
    def calculate_optimal_taps(decimation_factor, window='hamming'):
        base_taps = {
            'hamming': 15, 'hann': 15,
            'blackman': 20, 'kaiser': 25
        }
        taps_per_decade = base_taps.get(window, 15)
        recommended = taps_per_decade * decimation_factor
        recommended = max(31, min(recommended, 501))
        if recommended % 2 == 0:
            recommended += 1
        return recommended

    @staticmethod
    def compute_psd_db(data, fft_size, fs_hz):
        frame = data[:fft_size]
        win = np.hanning(fft_size)
        # RMS normalise — makes PSD decimation-invariant
        win = win / np.sqrt(np.sum(win ** 2))
        X = np.fft.fftshift(np.fft.fft(frame * win, n=fft_size))
        psd = (np.abs(X) ** 2) / fs_hz
        power_db = 10 * np.log10(psd + 1e-20)
        freqs_mhz = np.fft.fftshift(np.fft.fftfreq(fft_size, 1.0 / fs_hz)) / 1e6
        return power_db, freqs_mhz

    @staticmethod
    def estimate_noise_floor(power_db, peak_idx, fft_size):
        # 1. Restrict to center 50% to avoid LPF roll-offs at the edges
        q = fft_size // 4
        center_band = power_db[q : 3*q]
        
        # 2. Exclude the signal peak area from the candidates
        peak_idx_rel = peak_idx - q
        if 0 <= peak_idx_rel < len(center_band):
            # Exclude ±2.5% around the peak
            exclude_width = max(2, fft_size // 40)
            mask = np.ones(len(center_band), dtype=bool)
            mask[max(0, peak_idx_rel - exclude_width) : min(len(center_band), peak_idx_rel + exclude_width + 1)] = False
            noise_candidates = center_band[mask]
        else:
            noise_candidates = center_band

        if len(noise_candidates) == 0:
            return float(np.median(power_db))

        # 3. Sort and take the median of the bottom 50% of these valid passband bins
        # This completely ignores the top 50% (which might contain signal skirts)
        sorted_pwr = np.sort(noise_candidates)
        noise_db = float(np.median(sorted_pwr[:max(1, len(sorted_pwr) // 2)]))
        return noise_db
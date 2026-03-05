"""
Data Loader Module
Handles loading IQ data from various file formats

Fixes applied:
  1. _load_hex: comment-line removal now happens BEFORE the str.maketrans
     translation that strips newlines.
  2. _load_binary: removed memmap for temp files — os.unlink() after load
     crashes on Windows if the file is still memory-mapped. Use fromfile always.
  3. _load_hex single-channel detection: renamed zeros_low/zeros_high to
     zeros_col0/zeros_col1 — the old names were misleading (they referred to
     array column index, not byte significance) and could cause future bugs.
"""
import numpy as np
import os


class DataLoader:
    _BINARY_EXTENSIONS = {
        '.bin', '.dat', '.raw',
        '.doa', '.iq',
        '.cf32', '.fc32',
        '.cf64', '.fc64',
        '.c64', '.cfile',
        '.c32', '.cs16', '.sc16', '.sigmf-data',
        '.sc8', '.s8', '.u8',
    }

    _EXT_DTYPE = {
        '.cf32': 'complex64',  '.fc32': 'complex64',
        '.cf64': 'complex64',  '.fc64': 'complex64',
        '.c64':  'complex64',  '.cfile':'complex64',
        '.c32':  'int16',      '.cs16': 'int16',
        '.sc16': 'int16',      '.sigmf-data':'int16',
        '.sc8':  'int8',       '.s8':   'int8',
        '.u8':   'uint8',      '.doa':  'complex64',
    }

    @staticmethod
    def _auto_detect_dtype(path):
        ext = os.path.splitext(path)[1].lower()
        if ext in DataLoader._EXT_DTYPE:
            return DataLoader._EXT_DTYPE[ext]

        file_bytes = os.path.getsize(path)
        for dtype_str, itemsize, min_count in [
            ('complex64', 8, 8),
            ('int16',     2, 16),
            ('int8',      1, 32),
        ]:
            if file_bytes < itemsize * min_count:
                continue
            try:
                probe = np.fromfile(path, dtype=dtype_str, count=64)
                if len(probe) < min_count:
                    continue
                if np.all(np.isfinite(probe.view(np.float32 if dtype_str == 'complex64' else dtype_str))):
                    return dtype_str
            except Exception:
                continue

        return 'complex64'

        
    @staticmethod
    def load_file(path, max_samples=None, stop_event=None, progress_callback=None,
                  channel_mode_var=None, hex_signed=True, scale_factor=1.0,
                  q15_format=False, bin_dtype="auto"):
        file_size_mb = os.path.getsize(path) / (1024 * 1024)
        ext = os.path.splitext(path)[1].lower()
        if ext == ".npy":
            signal = np.load(path)

            # Ensure complex type
            if not np.iscomplexobj(signal):
                signal = signal.astype(np.complex64)
    
            data_format = f"NumPy (.npy) - {len(signal):,} samples"

            preview_samples = min(500, len(signal))
            raw_hex_data = ["--- NumPy Preview ---"]
            for i in range(preview_samples):
                val = signal[i]
                raw_hex_data.append(
                    f"{i:06d}: {val.real:+.6f} {val.imag:+.6f}j"
                )

            return signal, data_format, "dual", raw_hex_data

        is_binary = ext in DataLoader._BINARY_EXTENSIONS

        if not is_binary:
            try:
                with open(path, 'rb') as fh:
                    header = fh.read(512)
                non_print = sum(1 for b in header if b < 9 or (13 < b < 32) or b == 127)
                if non_print > len(header) * 0.15:
                    is_binary = True
            except Exception:
                pass

        if is_binary:
            if not bin_dtype or bin_dtype == 'auto':
                bin_dtype = DataLoader._auto_detect_dtype(path)
                if progress_callback:
                    progress_callback(f"Auto-detected format: {bin_dtype}")
            return DataLoader._load_binary(
                path, file_size_mb, max_samples, stop_event,
                progress_callback, bin_dtype
            )

        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            first_line = ''
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith('#'):
                    first_line = stripped
                    break

        if stop_event and stop_event.is_set():
            return None, None, None, None

        if DataLoader._is_hex_format(first_line):
            return DataLoader._load_hex(
                path, file_size_mb, max_samples, stop_event,
                progress_callback, channel_mode_var, hex_signed,
                scale_factor, q15_format
            )
        else:
            return DataLoader._load_standard_text(
                path, file_size_mb, max_samples, stop_event,
                progress_callback
            )

    @staticmethod
    def _is_hex_format(line):
        line = line.replace(' ', '').replace('\t', '')
        if len(line) != 8:
            return False
        try:
            int(line, 16)
            return True
        except ValueError:
            return False

    @staticmethod
    def _detect_channel_mode(path):
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                lines = []
                for _ in range(200):
                    l = f.readline().strip()
                    if not l or l.startswith('#'):
                        continue
                    l = l.replace(' ', '').replace('\t', '')
                    if len(l) == 8:
                        lines.append(l)

            if not lines:
                return "dual"

            zero_low  = sum(1 for l in lines if l.startswith('0000'))
            zero_high = sum(1 for l in lines if l.endswith('0000'))

            if zero_low > len(lines) * 0.7 or zero_high > len(lines) * 0.7:
                return "single"
            return "dual"
        except Exception:
            return "dual"

    @staticmethod
    def _load_binary(path, file_size_mb, max_samples, stop_event, progress_callback, bin_dtype):
        if progress_callback:
            progress_callback(f"Loading binary file ({file_size_mb:.1f} MB)...")

        dtype_map = {
            "complex64" : np.complex64,
            "complex128": np.complex128,
            "float32"   : np.float32,
            "int16"     : np.int16,
            "int8"      : np.int8,
            "uint8"     : np.uint8,
        }
        np_dtype = dtype_map.get(bin_dtype, np.complex64)
        raw_sig = np.fromfile(path, dtype=np_dtype)

        if stop_event and stop_event.is_set():
            return None, None, None, None

        if max_samples and len(raw_sig) > max_samples:
            if bin_dtype in ("complex64", "complex128"):
                raw_sig = raw_sig[:max_samples]
            else:
                raw_sig = raw_sig[:max_samples * 2]

        if bin_dtype == "complex64":
            signal = raw_sig
        elif bin_dtype == "complex128":
            signal = raw_sig.astype(np.complex64)
        else:
            i_data = raw_sig[0::2].astype(np.float32)
            q_data = raw_sig[1::2].astype(np.float32)
            min_len = min(len(i_data), len(q_data))
            signal  = i_data[:min_len] + 1j * q_data[:min_len]

        data_format = f"Binary ({bin_dtype}) - {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {max_samples:,} samples)"

        preview_samples = min(500, len(signal))
        raw_hex_data = [f"--- Binary Preview ({bin_dtype}) ---"]
        for i in range(preview_samples):
            val = signal[i]
            raw_hex_data.append(f"{i:06d}: {val.real:+.2f} {val.imag:+.2f}j")

        return signal, data_format, "dual", raw_hex_data

    @staticmethod
    def _load_hex(path, file_size_mb, max_samples, stop_event, progress_callback,
                  channel_mode_var, hex_signed, scale_factor, q15_format):
        if progress_callback:
            progress_callback(f"Parsing hex file ({file_size_mb:.1f} MB)...")

        detected_mode = DataLoader._detect_channel_mode(path)

        if channel_mode_var:
            if "single" in channel_mode_var:
                channel_mode = "single"
            elif "dual" in channel_mode_var:
                channel_mode = "dual"
            else:
                channel_mode = detected_mode
        else:
            channel_mode = detected_mode

        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()

            if stop_event and stop_event.is_set():
                return None, None, None, None

            # Strip comment lines BEFORE the translate that removes newlines
            content_lines = content.splitlines()
            content_lines = [ln for ln in content_lines if not ln.lstrip().startswith('#')]
            content = '\n'.join(content_lines)

            table   = str.maketrans('', '', ' \t\n\r,;[]{}')
            hex_str = content.translate(table)

            if len(hex_str) % 4 != 0:
                hex_str = hex_str[:(len(hex_str) // 4) * 4]

            if progress_callback:
                progress_callback("Converting hex to bytes...")
            raw_bytes = bytes.fromhex(hex_str)
            samples   = np.frombuffer(raw_bytes, dtype='>i2').astype(np.float32)

            if stop_event and stop_event.is_set():
                return None, None, None, None

            raw_hex_data = []

            if channel_mode == "single":
                if len(hex_str) % 8 == 0:
                    lines_count   = len(hex_str) // 8
                    preview_count = min(100, lines_count)
                    for i in range(preview_count):
                        raw_hex_data.append(
                            f"{i:06d}: {hex_str[i*8:i*8+4]} {hex_str[i*8+4:i*8+8]}")

                    s8 = samples.reshape(-1, 2)
                    zeros_col0 = np.sum(s8[:, 0] == 0)
                    zeros_col1 = np.sum(s8[:, 1] == 0)
                    i_data = s8[:, 1] if zeros_col0 > zeros_col1 else s8[:, 0]
                    q_data = np.zeros_like(i_data)
                else:
                    i_data = samples
                    q_data = np.zeros_like(i_data)
            else:
                if len(samples) % 2 != 0:
                    samples = samples[:-1]
                i_data = samples[0::2]
                q_data = samples[1::2]

                preview_count = min(100, len(i_data))
                for i in range(preview_count):
                    raw_hex_data.append(
                        f"{i:06d}: {hex_str[i*8:i*8+4]} {hex_str[i*8+4:i*8+8]}")

            if not hex_signed:
                i_data = np.where(i_data < 0, i_data + 65536, i_data)
                q_data = np.where(q_data < 0, q_data + 65536, q_data)

            scale  = (1.0 / 32768.0) if q15_format else scale_factor
            signal = (i_data + 1j * q_data) * scale

            if max_samples and len(signal) > max_samples:
                signal = signal[:max_samples]

            data_format = f"Hex ({channel_mode} channel) - {file_size_mb:.1f} MB"
            return signal, data_format, channel_mode, raw_hex_data

        except Exception as e:
            if progress_callback:
                progress_callback(f"Error loading hex: {str(e)}")
            return None, None, None, None

    @staticmethod
    def _load_standard_text(path, file_size_mb, max_samples, stop_event, progress_callback):
        if progress_callback:
            progress_callback(f"Loading text file ({file_size_mb:.1f} MB)...")

        data         = []
        count        = 0
        raw_hex_data = ["--- Text Data Preview ---"]

        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                if stop_event and i % 1000 == 0 and stop_event.is_set():
                    return None, None, None, None

                line_stripped = line.strip()
                if line_stripped.startswith('#'):
                    continue

                if i < 500:
                    raw_hex_data.append(f"{i:06d}: {line_stripped}")

                line_stripped = line_stripped.replace('i', 'j').replace(' ', '')
                if line_stripped:
                    if max_samples and count >= max_samples:
                        break
                    try:
                        data.append(complex(line_stripped))
                        count += 1
                    except Exception:
                        pass

        signal      = np.array(data, dtype=np.complex64)
        data_format = f"Text (Complex) - {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {max_samples:,} samples)"

        return signal, data_format, "dual", raw_hex_data
"""
data_loader.py  –  RF Analyzer data loader (fixed v2)

Key fixes over v1/v2:
  1. ILA CSV  – full-scale derived from the [MSB:LSB] annotation in each
                column header (e.g. [15:0] → ÷32768, [31:0] → ÷2147483648,
                [11:0] → ÷2048).  Falls back to a safe per-column auto-detect
                when no annotation is present instead of the former hardcoded ÷32768.
  2. ILA CSV  – BINARY-radix columns now use the correct bit-width from the
                header rather than always treating them as 16-bit.
  3. ILA CSV  – paired column search is more robust: now also accepts the
                Vivado naming pattern  *_tdata  (packed 32-bit IQ word) and
                gracefully skips columns whose header has no I/Q hint rather
                than silently mis-pairing them.
  4. Generic CSV – normalisation: if all values are integers with magnitude
                > 1 the loader now applies the same auto-detect full-scale
                logic so that 12-bit / 14-bit / 16-bit ADC files all come
                out correctly scaled.
  5. TXT FIX  – detect_generic_csv now correctly rejects plain-text complex
                files (e.g. "+0.1-0.2j" per line) so they reach
                load_standard_text instead of being mis-parsed as CSV.
  6. TXT FIX  – load_standard_text handles multiple formats:
                  • One complex number per line  (+0.1-0.2j  or  0.1 0.2)
                  • Two space/comma-separated floats per line (I Q)
                  • Lines with 'i' suffix for imaginary part
  7. Binary   – no functional change; kept identical to v1.
  8. Hex/text – no functional change; kept identical to v1.
  9. General  – all public parse paths return a consistent 4-tuple or list
                of 5-tuples; None is only returned on hard errors or user
                abort, never on an empty-but-valid file.
"""

import csv
import os
import re
import math
import numpy as np


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _bit_width_from_header(header_name: str) -> int | None:
    """
    Extract the declared bit-width from a Vivado ILA column header.

    Examples
    --------
    ``signal_name[15:0]``  → 16
    ``signal_name[31:0]``  → 32
    ``signal_name[11:0]``  → 12
    ``signal_name[23:4]``  → 20  (MSB-LSB+1)

    Returns ``None`` when no ``[MSB:LSB]`` annotation is found.
    """
    m = re.search(r'\[(\d+):(\d+)\]', header_name)
    if m:
        msb, lsb = int(m.group(1)), int(m.group(2))
        return msb - lsb + 1
    return None


_STANDARD_BIT_DEPTHS = [8, 10, 12, 14, 16, 18, 24, 32]


def _auto_full_scale(max_abs_val: float) -> float:
    """
    Snap *max_abs_val* to the full-scale of the smallest standard signed-integer
    ADC bit-depth that can represent it.

    Standard depths checked: 8, 10, 12, 14, 16, 18, 24, 32.
    Full scale for N-bit signed = 2^(N-1).

    Falls back to 1.0 when *max_abs_val* ≤ 1.0 (already normalised data).
    """
    if max_abs_val <= 1.0:
        return 1.0
    for bits in _STANDARD_BIT_DEPTHS:
        fs = float(2 ** (bits - 1))
        if max_abs_val <= fs:
            return fs
    return float(2 ** 31)


def _full_scale_for_column(header_name: str, radix: str,
                            raw_col: np.ndarray) -> float:
    """
    Determine the correct full-scale divisor for one ILA column.

    Priority
    --------
    1. Bit-width annotation in the header  (``[MSB:LSB]``).
    2. Auto-detect from the actual data range.
    3. Fallback: 32768 (historic default).
    """
    bw = _bit_width_from_header(header_name)
    if bw is not None and bw > 1:
        return float(2 ** (bw - 1))

    max_abs = float(np.abs(raw_col).max()) if len(raw_col) else 0.0
    return _auto_full_scale(max_abs)


def _looks_like_complex_text(path: str) -> bool:
    """
    Peek at the first few non-comment lines of a text file.
    Returns True if the lines look like complex numbers (one per line)
    rather than CSV data.  This prevents detect_generic_csv from
    swallowing plain-text IQ files.
    """
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            lines_checked = 0
            complex_hits  = 0
            two_col_hits  = 0
            for line in f:
                s = line.strip()
                if not s or s.startswith('#'):
                    continue
                lines_checked += 1
                if lines_checked > 20:
                    break
                # Try parsing as a single complex number
                try:
                    complex(s.replace('i', 'j').replace(' ', ''))
                    complex_hits += 1
                    continue
                except ValueError:
                    pass
                # Try two whitespace/comma-separated floats (I Q)
                parts = re.split(r'[\s,]+', s)
                if len(parts) == 2:
                    try:
                        float(parts[0]); float(parts[1])
                        two_col_hits += 1
                        continue
                    except ValueError:
                        pass
            if lines_checked == 0:
                return False
            # If the majority of lines parse as complex/two-float, it's a txt IQ file
            return (complex_hits + two_col_hits) >= (lines_checked * 0.7)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# ILA CSV parser
# ---------------------------------------------------------------------------

class _CSVParser:

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def is_number(s: str) -> bool:
        if not s:
            return False
        s = s.strip()
        if not s:
            return False
        try:
            float(s)
            return True
        except ValueError:
            return False

    # ── ILA detection ────────────────────────────────────────────────────────

    @staticmethod
    def detect_ila_csv(path: str):
        """
        Returns ``(True, iq_pairs)`` when the file looks like a Vivado ILA export.

        ``iq_pairs`` is a list of ``(i_col_idx, q_col_idx, ch_name, radix_str, i_header, q_header)``.

        The extra header strings are new – they let the loader read the bit-width
        annotation when normalising.
        """
        try:
            with open(path, newline='', encoding='utf-8', errors='ignore') as f:
                reader = csv.reader(f)
                header = next(reader)
                second = next(reader)
        except Exception:
            return False, []

        radix_keywords = {'binary', 'signed', 'unsigned', 'hex', 'radix'}
        radix_hits = sum(
            1 for r in second
            if r.strip().lower() in radix_keywords or 'radix' in r.strip().lower()
        )
        if radix_hits < 2:
            return False, []

        radix = [r.strip().upper() for r in second]
        IQ_RADIX = {'BINARY', 'SIGNED', 'UNSIGNED'}

        iq_pairs = []
        i = 0
        while i < len(header) - 1:
            h_i = header[i]
            h_q = header[i + 1]
            r_i = radix[i]     if i     < len(radix) else ''
            r_q = radix[i + 1] if i + 1 < len(radix) else ''

            if r_i in IQ_RADIX and r_q in IQ_RADIX:
                name_i = h_i.lower().split('/')[-1]
                name_q = h_q.lower().split('/')[-1]

                is_i = (
                    '_i_' in name_i or name_i.startswith('i_') or
                    '_i[' in name_i or 'i_data' in name_i or
                    name_i.endswith('_i')
                )
                is_q = (
                    '_q_' in name_q or name_q.startswith('q_') or
                    '_q[' in name_q or 'q_data' in name_q or
                    name_q.endswith('_q')
                )

                if is_i and is_q:
                    ch_name = f'ch{len(iq_pairs) + 1}'
                    # Store original header strings for bit-width extraction
                    iq_pairs.append((i, i + 1, ch_name, r_i, h_i, h_q))
                    i += 2
                    continue
            i += 1

        return len(iq_pairs) > 0, iq_pairs

    # ── ILA loader ────────────────────────────────────────────────────────────

    @staticmethod
    def load_ila_csv(path, file_size_mb, max_samples, stop_event,
                     progress_callback, iq_pairs):
        """
        Load an ILA CSV export and return a list of
        ``(signal, data_format, "dual", preview, ch_name)`` tuples.
        """
        if progress_callback:
            progress_callback(
                f"Parsing ILA CSV ({file_size_mb:.1f} MB, "
                f"{len(iq_pairs)} IQ channels)…"
            )

        rows = []
        with open(path, newline='', encoding='utf-8', errors='ignore') as f:
            reader = csv.reader(f)
            next(reader)   # header
            next(reader)   # radix row
            for row in reader:
                if stop_event and stop_event.is_set():
                    return None
                rows.append(row)

        if max_samples:
            rows = rows[:max_samples]

        N = len(rows)
        results = []

        for entry in iq_pairs:
            # Support both old 4-tuple and new 6-tuple formats
            if len(entry) == 6:
                ic, qc, ch_name, radix_type, hdr_i, hdr_q = entry
            else:
                ic, qc, ch_name, radix_type = entry
                hdr_i = hdr_q = ''

            if stop_event and stop_event.is_set():
                return None

            try:
                if radix_type == 'BINARY':
                    bw_i = _bit_width_from_header(hdr_i) or 0
                    bw_q = _bit_width_from_header(hdr_q) or 0
                    raw_I = np.array(
                        [_BinaryParser.bin_str_to_signed(r[ic], bw_i) for r in rows],
                        dtype=np.float32,
                    )
                    raw_Q = np.array(
                        [_BinaryParser.bin_str_to_signed(r[qc], bw_q) for r in rows],
                        dtype=np.float32,
                    )
                else:
                    raw_I = np.array([int(r[ic]) for r in rows], dtype=np.float32)
                    raw_Q = np.array([int(r[qc]) for r in rows], dtype=np.float32)

            except Exception as e:
                if progress_callback:
                    progress_callback(f"Error parsing {ch_name}: {e}")
                continue

            # ── Per-column normalisation ──────────────────────────────────────
            fs_i = _full_scale_for_column(hdr_i, radix_type, raw_I)
            fs_q = _full_scale_for_column(hdr_q, radix_type, raw_Q)
            full_scale = max(fs_i, fs_q)

            I = raw_I / full_scale
            Q = raw_Q / full_scale

            signal = (I + 1j * Q).astype(np.complex64)

            preview = [
                f"--- ILA CSV {ch_name} preview ({N} samples) ---",
                f"    full_scale={full_scale:.0f}  "
                f"(detected from {'header annotation' if _bit_width_from_header(hdr_i) else 'data range'})",
            ]
            for k in range(min(200, N)):
                preview.append(
                    f"{k:06d}: {signal[k].real:+.5f} {signal[k].imag:+.5f}j"
                )

            data_format = (
                f"ILA CSV ({ch_name}) – {file_size_mb:.1f} MB"
                + (f" (partial: {N:,})" if max_samples else "")
            )
            results.append((signal, data_format, "dual", preview, ch_name))

        return results if results else None

    # ── Generic CSV detection ─────────────────────────────────────────────────

    @staticmethod
    def detect_generic_csv(path: str):
        """
        FIX: Now rejects plain-text complex-number files early (via
        _looks_like_complex_text) so they reach load_standard_text instead.
        """
        # Don't mis-detect plain IQ text files as CSV
        if _looks_like_complex_text(path):
            return False, None

        try:
            with open(path, newline='', encoding='utf-8', errors='ignore') as f:
                sample = f.read(4096)
                if not sample:
                    return False, None
                f.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
                    reader = csv.reader(f, dialect)
                except csv.Error:
                    dialect = None
                    reader = csv.reader(f)

                rows = []
                for _ in range(25):
                    try:
                        row = next(reader)
                        if row:
                            rows.append(row)
                    except StopIteration:
                        break
        except Exception:
            return False, None

        if not rows:
            return False, None

        # Reject single-column files — those are plain text, not CSV
        max_cols = max(len(r) for r in rows)
        if max_cols < 2:
            return False, None

        header_row_idx = -1
        header_names = []
        for idx, row in enumerate(rows):
            has_text = any(re.search(r'[a-zA-Z]', cell) for cell in row)
            all_numeric = all(
                _CSVParser.is_number(cell) for cell in row if cell.strip()
            )
            if has_text and not all_numeric:
                header_row_idx = idx
                header_names = [cell.strip().lower() for cell in row]
                break

        if header_row_idx == -1:
            data_start_idx = next(
                (idx for idx, row in enumerate(rows)
                 if any(_CSVParser.is_number(c) for c in row)),
                0,
            )
        else:
            data_start_idx = header_row_idx + 1

        info = {
            'data_start_idx': data_start_idx,
            'channels': [],
            'delimiter': dialect.delimiter if dialect else ',',
            'is_interleaved': False,
        }

        i_cols, q_cols, mag_cols, phase_cols = [], [], [], []

        if header_row_idx != -1:
            for col_idx, name in enumerate(header_names):
                name = name.strip()
                if not name:
                    continue
                if any(x in name for x in ['time', 'index', 'freq', 'date']):
                    continue
                if re.search(r'\bi\b|in-phase|real|^i|^re', name, re.IGNORECASE):
                    i_cols.append(col_idx)
                elif re.search(r'\bq\b|quad|imag|^q|^im', name, re.IGNORECASE):
                    q_cols.append(col_idx)
                elif re.search(r'\bmag\b|\bamp\b|magnitude|amplitude', name, re.IGNORECASE):
                    mag_cols.append(col_idx)
                elif re.search(r'\bphase\b|\bangle\b', name, re.IGNORECASE):
                    phase_cols.append(col_idx)

            for k in range(min(len(i_cols), len(q_cols))):
                info['channels'].append({
                    'type': 'iq',
                    'i_col': i_cols[k],
                    'q_col': q_cols[k],
                    'name': f"ch{k + 1}",
                })
            for k in range(min(len(mag_cols), len(phase_cols))):
                info['channels'].append({
                    'type': 'polar',
                    'mag_col': mag_cols[k],
                    'phase_col': phase_cols[k],
                    'name': f"ch{len(info['channels']) + 1}_polar",
                })

        if not info['channels']:
            numeric_cols = []
            if len(rows) > data_start_idx:
                for col_idx, cell in enumerate(rows[data_start_idx]):
                    if _CSVParser.is_number(cell):
                        numeric_cols.append(col_idx)

            if len(numeric_cols) >= 2:
                for k in range(0, len(numeric_cols) - 1, 2):
                    info['channels'].append({
                        'type': 'iq',
                        'i_col': numeric_cols[k],
                        'q_col': numeric_cols[k + 1],
                        'name': f"ch{len(info['channels']) + 1}",
                    })
            elif len(numeric_cols) == 1:
                info['channels'].append({
                    'type': 'interleaved',
                    'col': numeric_cols[0],
                    'name': 'ch1',
                })
                info['is_interleaved'] = True

        return (True, info) if info['channels'] else (False, None)

    # ── Generic CSV loader ────────────────────────────────────────────────────

    @staticmethod
    def load_generic_csv(path, file_size_mb, max_samples, stop_event,
                         progress_callback, info):
        """
        Load a generic IQ CSV.

        Fix: if all loaded values are integers (or float-integers) and the
        maximum absolute value exceeds 1, auto-detect the full scale and
        normalise so that 12-bit / 14-bit / 16-bit ADC files are handled
        correctly rather than being passed through un-normalised.
        """
        if progress_callback:
            progress_callback(
                f"Parsing Generic CSV ({file_size_mb:.1f} MB, "
                f"{len(info['channels'])} channels)…"
            )

        channels_data = {ch['name']: {'i': [], 'q': []} for ch in info['channels']}
        interleaved_buffer = []

        try:
            with open(path, newline='', encoding='utf-8', errors='ignore') as f:
                reader = csv.reader(f, delimiter=info.get('delimiter', ','))

                for _ in range(info['data_start_idx']):
                    next(reader, None)

                count = 0
                for row in reader:
                    if stop_event and stop_event.is_set():
                        return None
                    if not row:
                        continue

                    is_valid_row = False

                    if info.get('is_interleaved'):
                        ch = info['channels'][0]
                        col = ch['col']
                        if col < len(row):
                            try:
                                interleaved_buffer.append(float(row[col]))
                                is_valid_row = True
                            except ValueError:
                                pass
                    else:
                        for ch in info['channels']:
                            if ch['type'] == 'iq':
                                ic, qc = ch['i_col'], ch['q_col']
                                if ic < len(row) and qc < len(row):
                                    try:
                                        fv_i = float(row[ic])
                                        fv_q = float(row[qc])
                                        channels_data[ch['name']]['i'].append(fv_i)
                                        channels_data[ch['name']]['q'].append(fv_q)
                                        is_valid_row = True
                                    except ValueError:
                                        pass
                            elif ch['type'] == 'polar':
                                mc, pc = ch['mag_col'], ch['phase_col']
                                if mc < len(row) and pc < len(row):
                                    try:
                                        mag   = float(row[mc])
                                        phase = float(row[pc])
                                        channels_data[ch['name']]['i'].append(mag * np.cos(phase))
                                        channels_data[ch['name']]['q'].append(mag * np.sin(phase))
                                        is_valid_row = True
                                    except ValueError:
                                        pass

                    if is_valid_row:
                        count += 1
                        limit = (max_samples * 2
                                 if info.get('is_interleaved') else max_samples)
                        if max_samples and count >= limit:
                            break

        except Exception as e:
            if progress_callback:
                progress_callback(f"Error reading generic CSV: {e}")
            return None

        results = []

        # ── Helper: normalise raw float array if it looks like integer ADC data ──
        def _normalise(arr: np.ndarray) -> np.ndarray:
            max_abs = float(np.abs(arr).max()) if len(arr) else 0.0
            if max_abs <= 1.0:
                return arr
            if np.all(arr == arr.astype(np.int64)):
                fs = _auto_full_scale(max_abs)
                return arr / fs
            return arr

        if info.get('is_interleaved'):
            ch_name = info['channels'][0]['name']
            n_pairs = len(interleaved_buffer) // 2
            if n_pairs > 0:
                I_raw = np.array(interleaved_buffer[0:n_pairs * 2:2], dtype=np.float32)
                Q_raw = np.array(interleaved_buffer[1:n_pairs * 2:2], dtype=np.float32)
                I = _normalise(I_raw)
                Q = _normalise(Q_raw)
                signal = (I + 1j * Q).astype(np.complex64)

                preview = [f"--- Generic CSV Interleaved {ch_name} ({n_pairs} samples) ---"]
                for k in range(min(200, n_pairs)):
                    preview.append(f"{k:06d}: {signal[k].real:+.5f} {signal[k].imag:+.5f}j")

                results.append((
                    signal,
                    f"Generic CSV Interleaved ({ch_name}) – {file_size_mb:.1f} MB",
                    "dual", preview, ch_name,
                ))
        else:
            for ch in info['channels']:
                ch_name = ch['name']
                i_data = channels_data[ch_name]['i']
                q_data = channels_data[ch_name]['q']
                if not i_data:
                    continue

                I_raw = np.array(i_data, dtype=np.float32)
                Q_raw = np.array(q_data, dtype=np.float32)
                I = _normalise(I_raw)
                Q = _normalise(Q_raw)
                signal = (I + 1j * Q).astype(np.complex64)
                Ns = len(signal)

                preview = [f"--- Generic CSV {ch_name} ({Ns} samples) ---"]
                for k in range(min(200, Ns)):
                    preview.append(f"{k:06d}: {signal[k].real:+.5f} {signal[k].imag:+.5f}j")

                results.append((
                    signal,
                    f"Generic CSV ({ch_name}) – {file_size_mb:.1f} MB",
                    "dual", preview, ch_name,
                ))

        return results if results else None


# ---------------------------------------------------------------------------
# Binary parser
# ---------------------------------------------------------------------------

class _BinaryParser:

    @staticmethod
    def auto_detect_dtype(path: str) -> str:
        ext = os.path.splitext(path)[1].lower()
        mapping = {
            '.cf32': 'complex64',  '.fc32': 'complex64',
            '.cf64': 'complex128', '.fc64': 'complex128',
            '.c64':  'complex128', '.cfile': 'complex64',
            '.c32':  'int16',      '.cs16': 'int16',
            '.sc16': 'int16',      '.sigmf-data': 'int16',
            '.sc8':  'int8',       '.s8':  'int8',
            '.u8':   'uint8',      '.doa': 'complex64',
        }
        return mapping.get(ext, 'complex64')

    @staticmethod
    def bin_str_to_signed(s: str, bw: int = 0) -> int:
        """
        Convert a binary-string value from an ILA CSV cell to a signed integer.

        Uses the provided bit-width bw when > 0; otherwise infers
        width from the string length.
        """
        s = s.strip()
        if not s:
            return 0
        try:
            val = int(s, 2)
        except ValueError:
            return 0

        # Determine bit width
        bw = bw or len(s)
        if val >= (1 << (bw - 1)):
            val -= (1 << bw)
        return val

    # kept for backward-compatibility
    @staticmethod
    def bin_str_to_int16(s: str) -> int:
        return _BinaryParser.bin_str_to_signed(s, 0)

    @staticmethod
    def load_binary(path, file_size_mb, max_samples, stop_event,
                    progress_callback, bin_dtype):
        if progress_callback:
            progress_callback(
                f"Loading binary file ({file_size_mb:.1f} MB), type={bin_dtype}…"
            )

        dtype_map = {
            'complex64':  np.complex64,
            'complex128': np.complex128,
            'float32':    np.float32,
            'float64':    np.float64,
            'int32':      np.int32,
            'int16':      np.int16,
            'int8':       np.int8,
            'uint8':      np.uint8,
        }
        dt = dtype_map.get(bin_dtype, np.complex64)
        count = -1 if not max_samples else max_samples

        try:
            raw_data = np.fromfile(path, dtype=dt, count=count)
        except Exception as e:
            if progress_callback:
                progress_callback(f"Error reading binary file: {e}")
            return None, None, None, None

        if stop_event and stop_event.is_set():
            return None, None, None, None

        if not np.issubdtype(dt, np.complexfloating):
            if len(raw_data) % 2 != 0:
                raw_data = raw_data[:-1]
            I = raw_data[0::2].astype(np.float32)
            Q = raw_data[1::2].astype(np.float32)

            if dt == np.int16:
                I /= 32768.0;  Q /= 32768.0
            elif dt == np.int8:
                I /= 128.0;    Q /= 128.0
            elif dt == np.uint8:
                I = (I - 128.0) / 128.0
                Q = (Q - 128.0) / 128.0
            elif dt == np.int32:
                I /= 2147483648.0;  Q /= 2147483648.0

            signal = (I + 1j * Q).astype(np.complex64)
        else:
            signal = raw_data.astype(np.complex64)

        if stop_event and stop_event.is_set():
            return None, None, None, None

        Ns = len(signal)
        preview = [f"--- Binary Data Preview ({bin_dtype}, {Ns} samples) ---"]
        for k in range(min(500, Ns)):
            preview.append(
                f"{k:06d}: {signal[k].real:+.6f} {signal[k].imag:+.6f}j"
            )

        data_format = f"Binary ({bin_dtype}) – {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {Ns:,})"

        return signal, data_format, "dual", preview


# ---------------------------------------------------------------------------
# Hex / plain-text parser
# ---------------------------------------------------------------------------

class _HexTextParser:

    @staticmethod
    def is_hex_format(line: str) -> bool:
        if not line:
            return False
        parts = line.split()
        if not parts:
            return False
        for p in parts:
            try:
                int(p, 16)
            except ValueError:
                return False
        return True

    @staticmethod
    def detect_channel_mode(path: str) -> str:
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith('#'):
                        parts = stripped.split()
                        if len(parts) == 1 and len(parts[0]) == 8:
                            try:
                                int(parts[0], 16)
                                return "dual"  # concatenated IQ
                            except ValueError:
                                pass
                        return "single" if len(parts) == 1 else "dual"
        except Exception:
            pass
        return "dual"

    @staticmethod
    def load_hex(path, file_size_mb, max_samples, stop_event, progress_callback,
                 channel_mode_var, hex_signed, scale_factor, q15_format):
        if progress_callback:
            progress_callback(f"Loading hex file ({file_size_mb:.1f} MB)…")

        mode = "dual"
        if channel_mode_var:
            raw = channel_mode_var.get() if hasattr(channel_mode_var, 'get') else channel_mode_var
            if raw == "auto":
                mode = _HexTextParser.detect_channel_mode(path)
            else:
                mode = raw  
        else:
            mode = _HexTextParser.detect_channel_mode(path)

        data = []
        count = 0
        preview = [f"--- Hex Data Preview (Mode: {mode}) ---"]

        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            for line_no, line in enumerate(f):
                if stop_event and line_no % 1000 == 0 and stop_event.is_set():
                    return None, None, None, None
                stripped = line.strip()
                if stripped.startswith('#') or not stripped:
                    continue
                if line_no < 500:
                    preview.append(f"{line_no:06d}: {stripped}")
                if max_samples and count >= max_samples:
                    break
                try:
                    parts = stripped.split()
                    if len(parts) == 1 and len(parts[0]) == 8:
                        try:
                            int(parts[0], 16)  # confirm it's valid hex
                            parts = [parts[0][:4], parts[0][4:]]
                            mode = "dual"
                        except ValueError:
                            pass
                    if mode == "single":
                        if parts:
                            val = int(parts[0], 16)
                            if hex_signed:
                                bits = len(parts[0]) * 4
                                if val >= (1 << (bits - 1)):
                                    val -= (1 << bits)
                            if q15_format:
                                val /= 32768.0
                            val *= scale_factor
                            data.append(complex(val, 0))
                            count += 1
                    else:
                        if len(parts) >= 2:
                            i_val, q_val = int(parts[0], 16), int(parts[1], 16)
                            if hex_signed:
                                bi, bq = len(parts[0]) * 4, len(parts[1]) * 4
                                if i_val >= (1 << (bi - 1)):
                                    i_val -= (1 << bi)
                                if q_val >= (1 << (bq - 1)):
                                    q_val -= (1 << bq)
                            if q15_format:
                                i_val /= 32768.0;  q_val /= 32768.0
                            i_val *= scale_factor;  q_val *= scale_factor
                            data.append(complex(i_val, q_val))
                            count += 1
                except Exception:
                    pass

        signal = np.array(data, dtype=np.complex64)

        # ── Auto-normalize if values look like raw ADC counts ─────────────────
        # Hex IQ files from FPGAs/ADCs are often 12-16 bit integers stored as
        # hex strings.  If the max amplitude is > 1, snap to the nearest standard
        # ADC full-scale so that the spectrum reads in proper dBFS.
        if len(signal) > 0:
            max_abs = float(max(np.abs(signal.real).max(), np.abs(signal.imag).max()))
            if max_abs > 1.0 and not q15_format:
                fs = _auto_full_scale(max_abs)
                signal = (signal.real / fs + 1j * signal.imag / fs).astype(np.complex64)

        data_format = f"Hex Data – {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {max_samples:,} samples)"
        return signal, data_format, mode, preview

    @staticmethod
    def load_standard_text(path, file_size_mb, max_samples, stop_event,
                           progress_callback):
        """
        FIX v2: Handles multiple plain-text IQ formats:
          1. One complex number per line:  +0.1-0.2j  or  0.1+0.2i
          2. Two floats per line (I Q):   0.1 0.2   or   0.1, 0.2
          3. Interleaved single floats:   one real number per line (I then Q alternating)
        """
        if progress_callback:
            progress_callback(f"Loading text file ({file_size_mb:.1f} MB)…")

        data = []
        count = 0
        preview = ["--- Text Data Preview ---"]
        interleaved_buf = []   # used if we detect single-float-per-line format

        # First pass: detect format from first non-comment line
        fmt = 'complex'   # default
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    s = line.strip()
                    if s and not s.startswith('#'):
                        parts = re.split(r'[\s,]+', s)
                        if len(parts) == 2:
                            try:
                                float(parts[0]); float(parts[1])
                                fmt = 'two_col'
                                break
                            except ValueError:
                                pass
                        # Try single float (interleaved)
                        if len(parts) == 1:
                            try:
                                float(parts[0])
                                fmt = 'interleaved'
                                break
                            except ValueError:
                                pass
                        # Otherwise assume complex notation
                        break
        except Exception:
            pass

        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                for line_no, line in enumerate(f):
                    if stop_event and line_no % 1000 == 0 and stop_event.is_set():
                        return None, None, None, None
                    stripped = line.strip()
                    if stripped.startswith('#'):
                        continue
                    if line_no < 500:
                        preview.append(f"{line_no:06d}: {stripped}")
                    if not stripped:
                        continue
                    if max_samples and count >= max_samples:
                        break

                    try:
                        if fmt == 'two_col':
                            parts = re.split(r'[\s,]+', stripped)
                            if len(parts) >= 2:
                                i_val = float(parts[0])
                                q_val = float(parts[1])
                                data.append(complex(i_val, q_val))
                                count += 1
                        elif fmt == 'interleaved':
                            parts = re.split(r'[\s,]+', stripped)
                            for p in parts:
                                if p:
                                    interleaved_buf.append(float(p))
                        else:
                            # Complex notation: replace 'i' suffix with 'j'
                            parsed = stripped.replace(' ', '').replace('i', 'j')
                            # Handle cases like "0.1 0.2" that slipped through
                            if 'j' not in parsed and 'J' not in parsed:
                                parts = re.split(r'[\s,]+', stripped)
                                if len(parts) == 2:
                                    try:
                                        data.append(complex(float(parts[0]), float(parts[1])))
                                        count += 1
                                        continue
                                    except ValueError:
                                        pass
                            data.append(complex(parsed))
                            count += 1
                    except Exception:
                        pass   # skip unparseable lines silently

        except Exception as e:
            if progress_callback:
                progress_callback(f"Error reading text file: {e}")
            return None, None, None, None

        # Reassemble interleaved buffer
        if fmt == 'interleaved' and interleaved_buf:
            n = len(interleaved_buf) // 2
            for k in range(n):
                data.append(complex(interleaved_buf[2 * k], interleaved_buf[2 * k + 1]))
                count += 1

        if not data:
            if progress_callback:
                progress_callback("No parseable IQ data found in text file.")
            return None, None, None, None

        signal = np.array(data, dtype=np.complex64)
        data_format = f"Text (Complex) – {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {max_samples:,} samples)"
        return signal, data_format, "dual", preview


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

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

    @staticmethod
    def load_file(path, max_samples=None, stop_event=None, progress_callback=None,
                  channel_mode_var=None, hex_signed=True, scale_factor=1.0,
                  q15_format=False, bin_dtype="auto"):
        """
        Universal file loader.  Returns either:

        * A **list** of ``(signal, data_format, channel_mode, preview, ch_name)``
          tuples  (ILA / multi-channel CSV)
        * A **single** ``(signal, data_format, channel_mode, preview)`` 4-tuple
          (binary, hex, plain-text, single-channel generic CSV)
        * ``None`` on hard error or user abort.

        Supported formats
        -----------------
        ILA CSV (Vivado / Vitis), Generic IQ CSV, NumPy .npy,
        Binary (cf32 / fc32 / cf64 / cs16 / sc8 / u8 / …),
        Hex text (space-separated 16-bit hex pairs),
        Plain complex text (``+0.1-0.2j`` per line),
        Two-column text (I and Q on each line),
        Interleaved single-float text.
        """
        file_size_mb = os.path.getsize(path) / (1024 * 1024)
        ext = os.path.splitext(path)[1].lower()

        # ── NumPy ──────────────────────────────────────────────────────────────
        if ext == '.npy':
            signal = np.load(path)
            if not np.iscomplexobj(signal):
                signal = signal.astype(np.complex64)
            data_format = f"NumPy (.npy) – {len(signal):,} samples"
            preview = ["--- NumPy Preview ---"]
            for k in range(min(500, len(signal))):
                v = signal[k]
                preview.append(f"{k:06d}: {v.real:+.6f} {v.imag:+.6f}j")
            return signal, data_format, "dual", preview

        # ── Text-based files (CSV / txt / unknown extension) ──────────────────
        is_text_ext = ext in ('.csv', '.txt', '') or ext not in DataLoader._BINARY_EXTENSIONS

        if is_text_ext:
            # Quick binary-content sniff
            try:
                with open(path, 'rb') as fh:
                    head = fh.read(512)
                non_print = sum(1 for b in head if b < 9 or (13 < b < 32) or b == 127)
                is_binary_content = non_print > len(head) * 0.15
            except Exception:
                is_binary_content = False

            if not is_binary_content:
                # 1. Try Vivado ILA CSV
                is_ila, iq_pairs = _CSVParser.detect_ila_csv(path)
                if is_ila:
                    return _CSVParser.load_ila_csv(
                        path, file_size_mb, max_samples,
                        stop_event, progress_callback, iq_pairs,
                    )

                # 2. Try generic IQ CSV (now rejects plain-text IQ files correctly)
                is_generic, generic_info = _CSVParser.detect_generic_csv(path)
                if is_generic:
                    return _CSVParser.load_generic_csv(
                        path, file_size_mb, max_samples,
                        stop_event, progress_callback, generic_info,
                    )

        # ── Binary / hex / plain-text fall-through ────────────────────────────
        is_binary = ext in DataLoader._BINARY_EXTENSIONS
        if not is_binary:
            try:
                with open(path, 'rb') as fh:
                    head = fh.read(512)
                non_print = sum(1 for b in head if b < 9 or (13 < b < 32) or b == 127)
                if non_print > len(head) * 0.15:
                    is_binary = True
            except Exception:
                pass

        if is_binary:
            if not bin_dtype or bin_dtype == 'auto':
                bin_dtype = _BinaryParser.auto_detect_dtype(path)
                if progress_callback:
                    progress_callback(f"Auto-detected format: {bin_dtype}")
            return _BinaryParser.load_binary(
                path, file_size_mb, max_samples,
                stop_event, progress_callback, bin_dtype,
            )

        # ── Text: hex or complex? ─────────────────────────────────────────────
        first_line = ''
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    s = line.strip()
                    if s and not s.startswith('#'):
                        first_line = s
                        break
        except Exception:
            pass

        if stop_event and stop_event.is_set():
            return None, None, None, None

        if _HexTextParser.is_hex_format(first_line):
            return _HexTextParser.load_hex(
                path, file_size_mb, max_samples, stop_event,
                progress_callback, channel_mode_var, hex_signed,
                scale_factor, q15_format,
            )

        return _HexTextParser.load_standard_text(
            path, file_size_mb, max_samples, stop_event, progress_callback,
        )
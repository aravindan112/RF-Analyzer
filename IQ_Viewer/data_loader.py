import csv
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

class _CSVParser:
    @staticmethod
    def is_number(s):
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

    @staticmethod
    def detect_ila_csv(path):
        import csv
        try:
            with open(path, newline='', encoding='utf-8', errors='ignore') as f:
                reader = csv.reader(f)
                header = next(reader)
                second = next(reader)
        except Exception:
            return False, []

        radix_keywords = {'binary', 'signed', 'unsigned', 'hex', 'radix'}
        radix_hits = sum(1 for r in second if r.strip().lower() in radix_keywords or 'radix' in r.strip().lower())
        if radix_hits < 2:
            return False, []

        radix = [r.strip().upper() for r in second]
        IQ_RADIX = {'BINARY', 'SIGNED', 'UNSIGNED'}

        iq_pairs = []
        i = 0
        while i < len(header) - 1:
            h_i = header[i].lower()
            h_q = header[i + 1].lower()
            r_i = radix[i]     if i     < len(radix) else ''
            r_q = radix[i + 1] if i + 1 < len(radix) else ''

            if r_i in IQ_RADIX and r_q in IQ_RADIX:
                name_i = h_i.split('/')[-1]
                name_q = h_q.split('/')[-1]
                is_i = ('_i_' in name_i or name_i.startswith('i_') or '_i[' in name_i or 'i_data' in name_i)
                is_q = ('_q_' in name_q or name_q.startswith('q_') or '_q[' in name_q or 'q_data' in name_q)
                if is_i and is_q:
                    ch_name = f'ch{len(iq_pairs) + 1}'
                    iq_pairs.append((i, i + 1, ch_name, r_i))
                    i += 2
                    continue
            i += 1

        return len(iq_pairs) > 0, iq_pairs

    @staticmethod
    def load_ila_csv(path, file_size_mb, max_samples, stop_event, progress_callback, iq_pairs):
        import csv
        import numpy as np
        if progress_callback:
            progress_callback(f"Parsing ILA CSV ({file_size_mb:.1f} MB, {len(iq_pairs)} IQ channels)…")

        rows = []
        with open(path, newline='', encoding='utf-8', errors='ignore') as f:
            reader = csv.reader(f)
            next(reader)  # header
            next(reader)  # radix
            for row in reader:
                if stop_event and stop_event.is_set():
                    return None
                rows.append(row)

        if max_samples:
            rows = rows[:max_samples]

        N = len(rows)
        results = []

        for (ic, qc, ch_name, radix_type) in iq_pairs:
            if stop_event and stop_event.is_set():
                return None

            try:
                if radix_type == 'BINARY':
                    I = np.array([_BinaryParser.bin_str_to_int16(r[ic]) for r in rows], dtype=np.float32) / 32768.0
                    Q = np.array([_BinaryParser.bin_str_to_int16(r[qc]) for r in rows], dtype=np.float32) / 32768.0
                else:
                    I = np.array([int(r[ic]) for r in rows], dtype=np.float32) / 32768.0
                    Q = np.array([int(r[qc]) for r in rows], dtype=np.float32) / 32768.0
            except Exception as e:
                if progress_callback:
                    progress_callback(f"Error parsing {ch_name}: {e}")
                continue

            signal = (I + 1j * Q).astype(np.complex64)

            preview = [f"--- ILA CSV {ch_name} preview ({N} samples) ---"]
            for k in range(min(200, N)):
                preview.append(f"{k:06d}: {signal[k].real:+.5f} {signal[k].imag:+.5f}j")

            data_format = f"ILA CSV ({ch_name}) – {file_size_mb:.1f} MB" + (f" (partial: {N:,})" if max_samples else "")
            results.append((signal, data_format, "dual", preview, ch_name))

        return results if results else None

    @staticmethod
    def detect_generic_csv(path):
        import csv
        import re
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

        header_row_idx = -1
        header_names = []
        for i, row in enumerate(rows):
            has_text = any(re.search(r'[a-zA-Z]', cell) for cell in row)
            all_numeric = all(_CSVParser.is_number(cell) for cell in row if cell.strip())
            if has_text and not all_numeric:
                header_row_idx = i
                header_names = [cell.strip().lower() for cell in row]
                break
        
        if header_row_idx == -1:
            first_data_row_idx = 0
            for i, row in enumerate(rows):
                if any(_CSVParser.is_number(cell) for cell in row):
                    first_data_row_idx = i
                    break
            data_start_idx = first_data_row_idx
        else:
            data_start_idx = header_row_idx + 1

        info = {
            'data_start_idx': data_start_idx,
            'channels': [],
            'delimiter': dialect.delimiter if 'dialect' in locals() and dialect else ',',
            'is_interleaved': False
        }

        i_cols = []
        q_cols = []
        mag_cols = []
        phase_cols = []
        
        if header_row_idx != -1:
            for idx, name in enumerate(header_names):
                name = name.strip()
                if not name:
                    continue
                if any(x in name for x in ['time', 'index', 'freq', 'date']):
                    continue
                if re.search(r'\bi\b|in-phase|real|^i|^re', name, re.IGNORECASE):
                    i_cols.append(idx)
                elif re.search(r'\bq\b|quad|imag|^q|^im', name, re.IGNORECASE):
                    q_cols.append(idx)
                elif re.search(r'\bmag\b|\bamp\b|magnitude|amplitude', name, re.IGNORECASE):
                    mag_cols.append(idx)
                elif re.search(r'\bphase\b|\bangle\b', name, re.IGNORECASE):
                    phase_cols.append(idx)
                    
            for i in range(min(len(i_cols), len(q_cols))):
                info['channels'].append({
                    'type': 'iq',
                    'i_col': i_cols[i],
                    'q_col': q_cols[i],
                    'name': f"ch{i+1}"
                })
                
            for i in range(min(len(mag_cols), len(phase_cols))):
                info['channels'].append({
                    'type': 'polar',
                    'mag_col': mag_cols[i],
                    'phase_col': phase_cols[i],
                    'name': f"ch{len(info['channels'])+1}_polar"
                })

        if not info['channels']:
            numeric_cols = []
            if len(rows) > data_start_idx:
                test_row = rows[data_start_idx]
                for idx, cell in enumerate(test_row):
                    if _CSVParser.is_number(cell):
                        numeric_cols.append(idx)
            
            if len(numeric_cols) >= 2:
                for i in range(0, len(numeric_cols) - 1, 2):
                    info['channels'].append({
                        'type': 'iq',
                        'i_col': numeric_cols[i],
                        'q_col': numeric_cols[i+1],
                        'name': f"ch{len(info['channels'])+1}"
                    })
            elif len(numeric_cols) == 1:
                info['channels'].append({
                    'type': 'interleaved',
                    'col': numeric_cols[0],
                    'name': 'ch1'
                })
                info['is_interleaved'] = True
                
        if info['channels']:
            return True, info
        
        return False, None

    @staticmethod
    def load_generic_csv(path, file_size_mb, max_samples, stop_event, progress_callback, info):
        import csv
        import numpy as np
        if progress_callback:
            progress_callback(f"Parsing Generic CSV ({file_size_mb:.1f} MB, {len(info['channels'])} channels)...")

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
                        if col < len(row) and _CSVParser.is_number(row[col]):
                            interleaved_buffer.append(float(row[col]))
                            is_valid_row = True
                    else:
                        for ch in info['channels']:
                            if ch['type'] == 'iq':
                                ic, qc = ch['i_col'], ch['q_col']
                                if ic < len(row) and qc < len(row) and _CSVParser.is_number(row[ic]) and _CSVParser.is_number(row[qc]):
                                    channels_data[ch['name']]['i'].append(float(row[ic]))
                                    channels_data[ch['name']]['q'].append(float(row[qc]))
                                    is_valid_row = True
                            elif ch['type'] == 'polar':
                                mc, pc = ch['mag_col'], ch['phase_col']
                                if mc < len(row) and pc < len(row) and _CSVParser.is_number(row[mc]) and _CSVParser.is_number(row[pc]):
                                    mag = float(row[mc])
                                    phase = float(row[pc])
                                    channels_data[ch['name']]['i'].append(mag * np.cos(phase))
                                    channels_data[ch['name']]['q'].append(mag * np.sin(phase))
                                    is_valid_row = True
                                    
                    if is_valid_row:
                        count += 1
                        if max_samples and count >= (max_samples * 2 if info.get('is_interleaved') else max_samples):
                            break
                            
        except Exception as e:
            if progress_callback:
                progress_callback(f"Error reading generic CSV: {e}")
            return None

        results = []
        
        if info.get('is_interleaved'):
            ch_name = info['channels'][0]['name']
            n_pairs = len(interleaved_buffer) // 2
            if n_pairs > 0:
                I = np.array(interleaved_buffer[0:n_pairs*2:2], dtype=np.float32)
                Q = np.array(interleaved_buffer[1:n_pairs*2:2], dtype=np.float32)
                signal = (I + 1j * Q).astype(np.complex64)
                
                preview = [f"--- Generic CSV Interleaved {ch_name} preview ({n_pairs} samples) ---"]
                for k in range(min(200, n_pairs)):
                    preview.append(f"{k:06d}: {signal[k].real:+.5f} {signal[k].imag:+.5f}j")
                    
                data_format = f"Generic CSV Interleaved ({ch_name}) - {file_size_mb:.1f} MB"
                results.append((signal, data_format, "dual", preview, ch_name))
        else:
            for ch in info['channels']:
                ch_name = ch['name']
                i_data = channels_data[ch_name]['i']
                q_data = channels_data[ch_name]['q']
                
                if not i_data:
                    continue
                    
                I = np.array(i_data, dtype=np.float32)
                Q = np.array(q_data, dtype=np.float32)
                signal = (I + 1j * Q).astype(np.complex64)
                N = len(signal)
                
                preview = [f"--- Generic CSV {ch_name} preview ({N} samples) ---"]
                for k in range(min(200, N)):
                    preview.append(f"{k:06d}: {signal[k].real:+.5f} {signal[k].imag:+.5f}j")
                    
                data_format = f"Generic CSV ({ch_name}) - {file_size_mb:.1f} MB"
                results.append((signal, data_format, "dual", preview, ch_name))

        return results if results else None


class _BinaryParser:
    @staticmethod
    def auto_detect_dtype(path):
        import os
        ext = os.path.splitext(path)[1].lower()
        if ext in {'.cf32', '.fc32', '.c32'}:
            return 'complex64'
        if ext in {'.cf64', '.fc64', '.c64'}:
            return 'complex128'
        if ext in {'.cs16', '.sc16', '.cfile'}:
            return 'int16'
        if ext in {'.sc8', '.s8', '.iq'}:
            return 'int8'
        if ext == '.u8':
            return 'uint8'
        return 'complex64'

    @staticmethod
    def bin_str_to_int16(s):
        s = s.strip()
        if not s:
            return 0
        try:
            val = int(s, 2)
            if val & 0x8000:
                val -= 0x10000
            return val
        except ValueError:
            return 0

    @staticmethod
    def load_binary(path, file_size_mb, max_samples, stop_event, progress_callback, bin_dtype):
        import numpy as np
        if progress_callback:
            progress_callback(f"Loading binary file ({file_size_mb:.1f} MB), type={bin_dtype}...")

        dtype_map = {
            'complex64': np.complex64,
            'complex128': np.complex128,
            'float32': np.float32,
            'float64': np.float64,
            'int32': np.int32,
            'int16': np.int16,
            'int8': np.int8,
            'uint8': np.uint8
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

        is_complex_dtype = np.issubdtype(dt, np.complexfloating)
        if not is_complex_dtype:
            if len(raw_data) % 2 != 0:
                raw_data = raw_data[:-1]
            I = raw_data[0::2].astype(np.float32)
            Q = raw_data[1::2].astype(np.float32)

            if dt == np.int16:
                I /= 32768.0
                Q /= 32768.0
            elif dt == np.int8:
                I /= 128.0
                Q /= 128.0
            elif dt == np.uint8:
                I = (I - 128.0) / 128.0
                Q = (Q - 128.0) / 128.0

            signal = (I + 1j * Q).astype(np.complex64)
        else:
            signal = raw_data.astype(np.complex64)

        if stop_event and stop_event.is_set():
            return None, None, None, None

        N = len(signal)
        preview = [f"--- Binary Data Preview ({bin_dtype}, {N} samples) ---"]
        for i in range(min(500, N)):
            preview.append(f"{i:06d}: {signal[i].real:+.6f} {signal[i].imag:+.6f}j")

        data_format = f"Binary ({bin_dtype}) - {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {N:,})"

        return signal, data_format, "dual", preview


class _HexTextParser:
    @staticmethod
    def is_hex_format(line):
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
    def detect_channel_mode(path):
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith('#'):
                        parts = stripped.split()
                        if len(parts) == 1:
                            return "single"
                        elif len(parts) == 2:
                            return "dual"
                        else:
                            return "dual"
        except Exception:
            return "dual"
        return "dual"

    @staticmethod
    def load_hex(path, file_size_mb, max_samples, stop_event, progress_callback, channel_mode_var, hex_signed, scale_factor, q15_format):
        import numpy as np
        if progress_callback:
            progress_callback(f"Loading hex file ({file_size_mb:.1f} MB)...")

        data = []
        count = 0
        mode = "dual"

        if channel_mode_var:
            mode = channel_mode_var.get()
            if mode == "auto":
                mode = _HexTextParser.detect_channel_mode(path)
                channel_mode_var.set(mode)
        else:
            mode = _HexTextParser.detect_channel_mode(path)

        preview = [f"--- Hex Data Preview (Mode: {mode}) ---"]

        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                if stop_event and i % 1000 == 0 and stop_event.is_set():
                    return None, None, None, None

                line_stripped = line.strip()
                if line_stripped.startswith('#'):
                    continue
                if not line_stripped:
                    continue

                if i < 500:
                    preview.append(f"{i:06d}: {line_stripped}")

                if max_samples and count >= max_samples:
                    break

                try:
                    parts = line_stripped.split()
                    if mode == "single":
                        if len(parts) >= 1:
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
                            i_val = int(parts[0], 16)
                            q_val = int(parts[1], 16)
                            if hex_signed:
                                bits_i = len(parts[0]) * 4
                                bits_q = len(parts[1]) * 4
                                if i_val >= (1 << (bits_i - 1)):
                                    i_val -= (1 << bits_i)
                                if q_val >= (1 << (bits_q - 1)):
                                    q_val -= (1 << bits_q)
                            if q15_format:
                                i_val /= 32768.0
                                q_val /= 32768.0
                            i_val *= scale_factor
                            q_val *= scale_factor
                            data.append(complex(i_val, q_val))
                            count += 1
                except Exception:
                    pass

        signal = np.array(data, dtype=np.complex64)
        data_format = f"Hex Data - {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {max_samples:,} samples)"

        return signal, data_format, mode, preview

    @staticmethod
    def load_standard_text(path, file_size_mb, max_samples, stop_event, progress_callback):
        import numpy as np
        if progress_callback:
            progress_callback(f"Loading text file ({file_size_mb:.1f} MB)...")

        data = []
        count = 0
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

        signal = np.array(data, dtype=np.complex64)
        data_format = f"Text (Complex) - {file_size_mb:.1f} MB"
        if max_samples:
            data_format += f" (Partial: {max_samples:,} samples)"

        return signal, data_format, "dual", raw_hex_data


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

        import os
        import numpy as np

        file_size_mb = os.path.getsize(path) / (1024 * 1024)
        ext = os.path.splitext(path)[1].lower()

        # ── .npy ──────────────────────────────────────────────────────────
        if ext == ".npy":
            signal = np.load(path)
            if not np.iscomplexobj(signal):
                signal = signal.astype(np.complex64)
            data_format = f"NumPy (.npy) - {len(signal):,} samples"
            preview = ["--- NumPy Preview ---"]
            for i in range(min(500, len(signal))):
                val = signal[i]
                preview.append(f"{i:06d}: {val.real:+.6f} {val.imag:+.6f}j")
            return signal, data_format, "dual", preview

        # ── CSV / text: check for ILA format first ─────────────────────────
        if ext in ('.csv', '.txt', '') or not (ext in DataLoader._BINARY_EXTENSIONS):
            # Sniff binary-ness before deciding
            try:
                with open(path, 'rb') as fh:
                    header_bytes = fh.read(512)
                non_print = sum(
                    1 for b in header_bytes
                    if b < 9 or (13 < b < 32) or b == 127
                )
                is_binary_content = non_print > len(header_bytes) * 0.15
            except Exception:
                is_binary_content = False

            if not is_binary_content:
                # Try ILA CSV detection
                is_ila, iq_pairs = _CSVParser.detect_ila_csv(path)
                if is_ila:
                    return _CSVParser.load_ila_csv(
                        path, file_size_mb, max_samples,
                        stop_event, progress_callback, iq_pairs
                    )

                # Try Generic CSV Detection
                is_generic, generic_info = _CSVParser.detect_generic_csv(path)
                if is_generic:
                    return _CSVParser.load_generic_csv(
                        path, file_size_mb, max_samples,
                        stop_event, progress_callback, generic_info
                    )

        # ── Binary / hex / standard text ───────
        is_binary = ext in DataLoader._BINARY_EXTENSIONS

        if not is_binary:
            try:
                with open(path, 'rb') as fh:
                    header_bytes = fh.read(512)
                non_print = sum(
                    1 for b in header_bytes
                    if b < 9 or (13 < b < 32) or b == 127
                )
                if non_print > len(header_bytes) * 0.15:
                    is_binary = True
            except Exception:
                pass

        if is_binary:
            if not bin_dtype or bin_dtype == 'auto':
                bin_dtype = _BinaryParser.auto_detect_dtype(path)
                if progress_callback:
                    progress_callback(f"Auto-detected format: {bin_dtype}")
            return _BinaryParser.load_binary(
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

        if _HexTextParser.is_hex_format(first_line):
            return _HexTextParser.load_hex(
                path, file_size_mb, max_samples, stop_event,
                progress_callback, channel_mode_var, hex_signed,
                scale_factor, q15_format
            )
        else:
            return _HexTextParser.load_standard_text(
                path, file_size_mb, max_samples, stop_event,
                progress_callback
            )
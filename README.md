# RF Analyzer - IQ Visual Analyzer

A browser-based RF signal analyzer for visualizing IQ data files.

## Features
- Frequency Spectrum (FREQ SPAN) analysis
- Zero Span (0-SPAN) pulse visualization
- Constellation diagram
- Spectrogram view
- CFAR detection
- Filter Response
- DOA Estimator

## Project Structure
```
RF-Analyzer/
├── frontend/                   # React/Vite frontend
│   └── src/
│       └── components/
│           ├── SpectrumChart.jsx
│           ├── SpectrogramChart.jsx
│           ├── ConstellationChart.jsx
│           ├── CfarChart.jsx
│           ├── FilterResponseChart.jsx
│           ├── IQTimeSeriesChart.jsx
│           └── DoaChart.jsx
├── IQ_Viewer/                  # Python backend
│   ├── main_api.py
│   ├── dsp_processing.py
│   ├── data_loader.py
│   └── data_manager.py
└── .gitignore
```

## Requirements
### Frontend
- Node.js

### Backend
- Python 3.x

## How to Run

### Step 1 - Start Backend
```bash
cd IQ_Viewer
python main_api.py
```

### Step 2 - Start Frontend (open a new terminal)
```bash
cd frontend
npm install
npm run dev
```

Frontend runs on: `http://localhost:5173`
Backend runs on: `http://localhost:8000`

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
├── frontend/        # React/Vite frontend
│   └── src/
│       └── components/
├── IQ_Viewer/       # Python backend
│   ├── main_api.py
│   ├── dsp_processing.py
│   ├── data_loader.py
│   └── data_manager.py
```

## Requirements
### Frontend
- Node.js
- npm install
- npm run dev

### Backend
- Python 3.x

### Commands (2 terminals one for frontend, one for backend)
-- For Frontend ---> cd frontend
npm install( only use it if its the first time or for pulling after new changes)
npm run dev

-- For Backend --->cd IQ_Viewer
pip install
python main_api.py

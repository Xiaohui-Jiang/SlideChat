# 🔬 SlideChat

A modern web application for viewing and analyzing biological slides with integrated AI multiagent analysis system. Built with React, TypeScript, Express.js, and Python FastAPI.

## 🚀 Features

- **📁 Project Management**: Organize slides, images, and analysis results by project
- **🔍 Slide Viewer**: High-resolution image viewing with OpenSeaDragon integration
- **🎯 ROI Selection**: Draw and manage regions of interest on slides for focused analysis
- **🤖 AI Multiagent Analysis**: Comprehensive biological data analysis powered by Python multiagent system
  - Single-cell RNA-seq analysis
  - Spatial transcriptomics
  - Cell type identification
  - Differential expression analysis
  - Automated report generation with visualizations
- **💬 Interactive Chat**: Real-time interaction with analysis agents
- **📊 Xenium Integration**: Built-in support for 10x Genomics Xenium spatial data
- **📱 Responsive Design**: Modern UI built with Tailwind CSS
- **⚡ Real-time Updates**: Live analysis progress tracking and results display

## 🏗️ Architecture

### System Overview

```
Frontend (React/TypeScript) - Port 3000
    ↓
Node.js Server (Express) - Port 5050
    ├─ LangChain Agent (Basic slide analysis)
    ├─ Project/Upload/Xenium APIs
    └─ Proxy → Python Multiagent Service
                ↓
        FastAPI Server (Python) - Port 8000
            └─ BioAnalysisAgent (Advanced biological analysis)
```

### Frontend (React + TypeScript)
- **Port**: 3000 (development)
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 3
- **Image Viewer**: OpenSeaDragon for high-resolution slides

### Node.js Backend (Express)
- **Port**: 5050 (configurable)
- **Framework**: Express.js 5
- **Features**: 
  - Project management and file uploads
  - ROI processing pipeline
  - Xenium data analysis
  - LangChain agent for basic queries
  - Proxy to Python multiagent service

### Python Backend (FastAPI)
- **Port**: 8000
- **Framework**: FastAPI with async support
- **Features**:
  - Multi-agent biological analysis system
  - Automated workflow planning
  - Interactive parameter collection
  - Comprehensive report generation (text + PDF)
  - Background job processing

## 📁 Project Structure

```
slidechat/
├─ README.md
├─ .env.example                  # envs for dev (PORT, CORS_ORIGIN, paths)
├─ package.json                  # root scripts (proxy run tasks)
│
├─ client/                       # React + Vite + TS + Tailwind
│  ├─ index.html
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ tailwind.config.js
│  ├─ postcss.config.js
│  └─ src/
│     ├─ main.tsx
│     ├─ App.tsx
│     ├─ index.css
│     ├─ routes/
│     │  ├─ Slides.tsx          # gallery/list of slides (thumbnails)
│     │  └─ SlideDetail.tsx     # big viewer + chat + ROI panel
│     ├─ components/
│     │  ├─ UploadBar.tsx
│     │  ├─ SlideViewer.tsx     # OpenSeadragon wrapper, overlays
│     │  ├─ ROIList.tsx         # add/rename/delete/select ROIs
│     │  ├─ ChatPanel.tsx       # (co-pilot later) simple prompts now
│     │  └─ AnalysisPanel.tsx   # artifacts (PNG) + metrics (JSON)
│     ├─ lib/
│     │  ├─ api.ts              # REST calls
│     │  ├─ ws.ts               # (placeholder) future chat stream
│     │  └─ auth.ts             # (optional) stub
│     ├─ store/
│     │  └─ appState.ts         # slide/ROI/run state (Zustand/Redux)
│     └─ types.ts               # shared client types
│
└─ server/                       # Express (Node 20)
   ├─ package.json
   ├─ index.js                   # app bootstrap, CORS, /api/health, /public
   ├─ config/
   │  └─ env.js                  # reads PORT, UPLOAD_DIR, PUBLIC_DIR, CORS
   ├─ routes/
   │  ├─ slides.js               # POST /slides, GET /slides/:id, list
   │  ├─ rois.js                 # POST/PATCH/DELETE /slides/:id/rois/:roiId
   │  ├─ runs.js                 # POST /slides/:id/rois/:roiId/run, GET /runs/:runId
   │  └─ health.js               # GET /api/health
   ├─ services/
   │  ├─ storage.js              # paths, save/read files, ensure dirs
   │  ├─ roi.js                  # GeoJSON validate, polygon/rect utils
   │  ├─ crops.js                # (MVP) rect crop via sharp/jimp; OpenSlide later
   │  ├─ metrics.js              # mean/std/hist from crop
   │  └─ reporter.js             # assemble summary JSON (+ optional MD/HTML)
   ├─ plans/
   │  └─ roi_quantify.js         # steps: crop → metrics → report (tiny array)
   ├─ data/
   │  ├─ db.json                 # (MVP) slides/rois/runs registry (or SQLite)
   │  └─ schemas/                # JSON schemas for inputs/outputs (zod/ajv)
   ├─ public/                    # served at /public (artifacts)
   │  └─ slides/
   │     └─ <slideId>/...        # crops, overlays, reports
   ├─ uploads/                   # raw uploads (SVS/PNG/TIFF)
   └─ logs/                      # access/error/run logs (winston/pino)

```

## 🛠️ Installation

### Prerequisites
- Node.js 18+ 
- Python 3.10+
- Conda (recommended for Python environment)
- npm or yarn

### Setup

1. **Clone the repository**
   ```bash
   git clone https://gitlab.oit.duke.edu/xj58/slidechat.git
   cd slidechat
   ```

2. **Install Node.js backend dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install frontend dependencies**
   ```bash
   cd ../client
   npm install
   ```

4. **Set up Python environment**
   ```bash
   cd ../langchain_multiagent_forfront
   
   # Create conda environment
   conda create -n Slidechat python=3.10
   conda activate Slidechat
   
   # Install Python dependencies
   pip install -r requirements.txt
   ```

5. **Configure environment variables**
   
   Create `.env` file in the `server` directory:
   ```bash
   PORT=5050
   OPENAI_API_KEY=your_openai_api_key_here
   LANGCHAIN_MODEL=gpt-4o-mini
   PYTHON_MULTIAGENT_URL=http://localhost:8000
   ```

## 🚀 Running the Application

### Development Mode (3 services required)

1. **Start Python Multiagent Service** (Terminal 1):
   ```bash
   cd langchain_multiagent_forfront
   conda activate Slidechat
   
   # Using conda environment's Python
   /opt/miniconda3/envs/Slidechat/bin/python -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload
   ```
   Service will start on `http://localhost:8000`
   - API Docs: http://localhost:8000/docs
   - Health Check: http://localhost:8000/api/health

2. **Start Node.js Backend Server** (Terminal 2):
   ```bash
   cd server
   npm run dev
   ```
   Server will start on `http://localhost:5050`

3. **Start Frontend** (Terminal 3):
   ```bash
   cd client
   npm run dev
   ```
   Frontend will start on `http://localhost:3000`

4. **Access the application**
   Open your browser to `http://localhost:3000`

### Quick Start Script

You can create a startup script `start.sh`:
```bash
#!/bin/bash

# Start Python backend
cd langchain_multiagent_forfront
/opt/miniconda3/envs/Slidechat/bin/python -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload &

# Start Node.js backend  
cd ../server
npm run dev &

# Start frontend
cd ../client
npm run dev

wait
```

### Production Build

1. **Build the frontend**:
   ```bash
   cd client
   npm run build
   ```

2. **Preview production build**:
   ```bash
   npm run preview
   ```

## 🔧 Configuration

### Backend Configuration
The server can be configured via environment variables:

```bash
PORT=5050  # Server port (default: 5050)
```

### Frontend Configuration
The Vite configuration handles:
- **Proxy**: API calls to backend (`/api/*` → `http://localhost:5050`)
- **Port**: Development server port (3000)
- **Build**: Production optimizations
- **API Base URL**: Use `VITE_API_BASE_URL` when serving the frontend from a domain that cannot proxy `/api` to the backend.

Create a `client/.env.local` file and add:

```
VITE_API_BASE_URL=http://localhost:5050/api
```

Adjust the host and protocol to match your backend deployment.

## 📡 API Endpoints

### Node.js Backend (Port 5050)

#### Project Management
```http
GET /api/projects                    # List all projects
POST /api/projects                   # Create new project
GET /api/projects/:id                # Get project details
DELETE /api/projects/:id             # Delete project
```

#### Upload & File Management
```http
POST /api/upload                     # Upload files to project
DELETE /api/projects/:projectId/images/:imageId/files/:fileType  # Delete file
```

#### ROI Management
```http
GET /api/projects/:projectId/images/:imageId/rois     # List ROIs
POST /api/projects/:projectId/images/:imageId/rois    # Create ROI
DELETE /api/projects/:projectId/images/:imageId/rois/:roiId  # Delete ROI
```

#### Xenium Analysis
```http
GET /api/xenium/datasets             # List available datasets
POST /api/xenium/analyze             # Run Xenium analysis
GET /api/xenium/results/:jobId       # Get analysis results
```

### Python Multiagent Service (Port 8000)

#### Analysis Jobs
```http
POST /api/multiagent/analyze
Content-Type: application/json

{
  "data_path": "/path/to/data.h5ad",
  "command": "Perform comprehensive analysis",
  "planner": "llm",
  "auto_mode": false
}

# Response
{
  "job_id": "uuid",
  "status": "pending",
  "created_at": "2025-12-08T12:00:00Z"
}
```

#### Job Status & Results
```http
GET /api/multiagent/status/:jobId           # Check job status
GET /api/multiagent/result/:jobId           # Get job result
GET /api/multiagent/messages/:jobId         # Get interaction messages
POST /api/multiagent/response/:jobId        # Submit user response to agent
```

#### Downloads
```http
GET /api/multiagent/download/:jobId/report  # Download text report
GET /api/multiagent/download/:jobId/pdf     # Download PDF with figures
GET /api/multiagent/download/:jobId/log     # Download execution log
```

#### Chat
```http
POST /api/multiagent/chat
Content-Type: application/json

{
  "message": "What is single-cell RNA-seq?",
  "session_id": "optional-session-id"
}
```

### Health Checks
```http
GET /api/health              # Node.js backend health
GET /api/health              # Python service health (via proxy)
```

## 💬 AI Multiagent Analysis System

SlideChat includes a sophisticated multiagent system for comprehensive biological data analysis.

### Key Capabilities

- **🧬 Single-cell Analysis**: 
  - Quality control and preprocessing
  - Normalization and scaling
  - Dimensionality reduction (PCA, UMAP, t-SNE)
  - Clustering (Leiden, Louvain)
  
- **🔬 Cell Type Identification**:
  - Marker gene analysis
  - Automated cell type annotation
  - Custom marker validation

- **📊 Differential Expression**:
  - Between-cluster comparisons
  - Statistical testing
  - Volcano plots and heatmaps

- **🗺️ Spatial Analysis**:
  - Spatial transcriptomics support
  - Neighborhood enrichment
  - Co-localization analysis

- **📝 Automated Reporting**:
  - Step-by-step execution logs
  - Comprehensive text reports
  - Publication-ready figures in PDF

### Workflow Example

1. **Submit Analysis Request**:
   ```json
   {
     "data_path": "./data/lung_sample.h5ad",
     "command": "Analyze cell types in lung tissue sample",
     "planner": "llm",
     "auto_mode": false
   }
   ```

2. **Agent Creates Plan**: AI generates step-by-step analysis plan

3. **Interactive Parameter Collection**: Agent asks for hyperparameters if needed

4. **Execution**: Agent runs each step with progress updates

5. **Results Delivery**: 
   - Text report with findings
   - PDF with all visualizations
   - Downloadable log file

### Chat Features

The system includes a general-purpose chat interface for:
- Answering biological questions
- Explaining analysis methods
- Providing guidance on data interpretation
- No analysis submission required

## 🎨 UI Components

### ProjectPanel
- **Features**: Create, manage, and switch between projects
- **Capabilities**: Upload files, organize images, view status

### ImageViewerPanel
- **Technology**: OpenSeaDragon for zoom/pan capabilities
- **Features**: ROI creation and management, high-resolution viewing
- **File Support**: Images, DZI tiles, and processed WSI files
- **Controls**: Keyboard shortcuts for ROI tools (Ctrl/Cmd + drag)

### ChatMultiagent
- **Features**: 
  - Submit analysis jobs
  - Real-time progress tracking
  - Interactive parameter input
  - View and download results
- **Integration**: Direct connection to Python multiagent service

### LogResultsPanel
- **Display**: Analysis logs, results, and multiagent job outputs
- **Features**: Filterable logs, expandable results, download links

## 🔄 Data Flow

1. **File Upload**: User drops file → UploadBar → API → Server processing
2. **Slide Display**: Processed files → SlideViewer → OpenSeaDragon rendering  
3. **Chat**: User input → ChatPanel → API → Response handling
4. **State Management**: App.tsx coordinates all component state

## 🚧 Planned Features

- **Enhanced Spatial Analysis**: More advanced spatial statistics and visualization
- **Multi-omics Integration**: Combine transcriptomics with proteomics data
- **Collaboration**: Multi-user analysis sharing and discussion
- **Custom Workflows**: User-defined analysis pipelines
- **Cloud Deployment**: Scalable cloud infrastructure support
- **Authentication**: User management and secure access control

## 🐛 Troubleshooting

### Port Conflicts
```bash
# Kill processes on port 3000 (frontend)
lsof -ti:3000 | xargs kill -9

# Kill processes on port 5050 (Node.js backend)
lsof -ti:5050 | xargs kill -9

# Kill processes on port 8000 (Python backend)
lsof -ti:8000 | xargs kill -9
```

### Python Service Issues

**uvicorn command not found:**
- Ensure conda environment is activated: `conda activate Slidechat`
- Use full path: `/opt/miniconda3/envs/Slidechat/bin/python -m uvicorn api:app`

**Import errors:**
- Verify all dependencies installed: `pip install -r requirements.txt`
- Check you're in the correct directory: `langchain_multiagent_forfront/`

**Port 8000 already in use:**
- Find and kill the process: `lsof -ti:8000 | xargs kill -9`
- Or use a different port: `uvicorn api:app --port 8001`
- Update `PYTHON_MULTIAGENT_URL` in Node.js `.env` accordingly

### API Connection Issues

**Node.js can't connect to Python service:**
- Ensure Python service is running on port 8000
- Check `PYTHON_MULTIAGENT_URL` in `server/.env`
- Verify no firewall blocking localhost connections
- Check server logs for connection errors

**Frontend can't reach backend:**
- Ensure Node.js backend is running on port 5050
- Check Vite proxy configuration in `vite.config.ts`
- Verify CORS settings in server

### Build Issues
- Clear node_modules: `rm -rf node_modules && npm install`
- Clear Vite cache: `npx vite --force`
- Clear Python cache: `find . -type d -name __pycache__ -exec rm -rf {} +`

### ROI Issues

**ROIs disappearing when switching projects/images:**
- This has been fixed. ROIs are now properly cleared and reloaded when changing projects or images.
- ROIs persist during zoom/pan operations.
- Check browser console for ROI loading logs (🔄, 📦, ✨ emojis).

**ROIs not appearing:**
- Ensure the image is fully loaded (viewer status shows "Ready").
- Check that ROIs are created for the correct project and image.
- Verify ROI data exists in `server/data/projects/[projectId]/rois/[imageId].json`.

**Creating ROIs:**
- Hold `Ctrl` (Windows/Linux) or `Cmd` (Mac) and drag on the image to create an ROI.
- ROIs must be a minimum size (adjusted based on zoom level).
- ROIs are automatically saved and will reappear when you return to the image.

### Upload Issues

**File upload fails:**
- Check browser console for detailed error messages (📤, ❌ emojis).
- Verify the server is running and accessible.
- Ensure the image ID is specified (required for file uploads).
- Check that `server/data/projects/` directory exists and is writable.
- Look for server logs about the upload in the terminal.

**Image not displaying after upload:**
- Wait for preprocessing to complete (status will show "Processing" then "Ready").
- Check that DZI tiles were generated in `server/data/projects/[projectId]/tiles/`.
- Try clicking "Refresh Status" if tiles are ready but not loading.
- Verify the image file was uploaded correctly to `server/data/projects/[projectId]/[imageId]/files/`.

**Upload appears stuck:**
- Large files may take time to upload and process.
- Check server logs for preprocessing job status.
- Restart the server to reset the job queue if needed.
- Try uploading a smaller test image first to verify the system is working.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License.

## 🙏 Acknowledgments

- **OpenSeaDragon** - High-performance web-based image viewer
- **Tailwind CSS** - Utility-first CSS framework  
- **Vite** - Fast build tool and development server
- **Express.js** - Web application framework for Node.js
- **FastAPI** - Modern Python web framework
- **LangChain** - Framework for building LLM applications
- **Scanpy** - Single-cell analysis in Python
- **Squidpy** - Spatial molecular data analysis

## 📚 Additional Documentation

- **MERGE_SUMMARY.md** - Detailed code merge documentation
- **API Documentation** - http://localhost:8000/docs (Python service)
- **Project Guides** - See `/docs` directory for detailed usage guides

---

Built with ❤️ for biological data analysis and spatial transcriptomics research.

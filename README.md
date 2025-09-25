# 🔬 SlideChat

A modern web application for viewing and discussing medical slides (WSI files) with an integrated chat interface. Built with React, TypeScript, and Express.js.

## 🚀 Features

- **📁 File Upload**: Support for medical slide files (.svs) and regular images
- **🔍 Slide Viewer**: High-resolution image viewing with OpenSeaDragon integration
- **💬 Chat Interface**: Interactive chat panel for slide discussion
- **🎯 ROI Selection**: Draw regions of interest on slides for focused analysis
- **📱 Responsive Design**: Modern UI built with Tailwind CSS
- **⚡ Real-time Updates**: Live file processing and chat updates
- **🤖 LangChain Integration**: AI-powered biological analysis functions (experimental)

## 🏗️ Architecture

### Frontend (React + TypeScript)
- **Port**: 3000 (development)
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 3
- **Image Viewer**: OpenSeaDragon for high-resolution slides
- **LangChain Integration**: TypeScript API client for AI functions

### Backend (Node.js + Express)
- **Port**: 3001 (LangChain enhanced server)
- **Framework**: Express.js 5
- **File Processing**: Multer for uploads, planned OpenSlide integration
- **Static Serving**: Public slides directory
- **LangChain Stack**: @langchain/core, @langchain/openai, langchain packages
- **AI Integration**: OpenAI GPT for intelligent function orchestration
- **Schema Validation**: Zod library for type-safe input/output validation

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
└─ server/                       # Express (Node 20) + LangChain
   ├─ package.json
   ├─ index.js                   # Enhanced server with LangChain integration
   ├─ .env.example               # Environment configuration template
   ├─ lib/
   │  ├─ function-registry.js    # Extensible function system with Zod validation
   │  ├─ slide-functions.js      # Biological analysis functions
   │  └─ langchain-integration.js # LangChain agent setup with OpenAI
   ├─ test-functions.js          # Function testing script
   ├─ test-server.js             # HTTP API testing script
   ├─ config/
   │  └─ env.js                  # reads PORT, UPLOAD_DIR, PUBLIC_DIR, CORS, OPENAI_API_KEY
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
- npm or yarn

### Setup

1. **Clone the repository**
   ```bash
   git clone https://gitlab.oit.duke.edu/xj58/slidechat.git
   cd slidechat
   ```

2. **Install backend dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Install frontend dependencies**
   ```bash
   cd ../client
   npm install
   ```

## 🚀 Running the Application

### Development Mode

1. **Start the backend server** (in one terminal):
   ```bash
   cd server
   npm start
   ```
   Server will start on `http://localhost:3001`

2. **Start the frontend** (in another terminal):
   ```bash
   cd client
   npm run dev
   ```
   Frontend will start on `http://localhost:5173`

3. **Access the application**
   Open your browser to `http://localhost:5173`

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
Create `server/.env` file for configuration:

```bash
# Optional: OpenAI API Key for full LangChain functionality
OPENAI_API_KEY=your_openai_api_key_here

# Server configuration
PORT=3001                    # Server port (default: 3001 for LangChain integration)
NODE_ENV=development

# File paths
UPLOAD_DIR=./uploads
PUBLIC_DIR=./public

# CORS
CORS_ORIGIN=http://localhost:5173
```

**Note**: The system works without an OpenAI API key using mock responses and fallback functionality.

### Frontend Configuration
The Vite configuration handles:
- **Proxy**: API calls to backend (`/api/*` → `http://localhost:3001`)
- **Port**: Development server port (5173)
- **Build**: Production optimizations

## 📡 API Endpoints

### LangChain Integration Endpoints
```http
# List available functions
GET /api/functions

# Execute specific function
POST /api/functions/:name/execute
Content-Type: application/json
{
  "input": {
    "slideId": "lung_01",
    "analysisType": "morphology"
  }
}

# Chat with LangChain agent
POST /api/chat
Content-Type: application/json
{
  "message": "Get information about slide lung_01",
  "context": {}
}

# Get usage examples
GET /api/examples

# Health check
GET /api/health
```

### Legacy Slide Management Endpoints
```http
# Upload Slide
POST /api/upload
Content-Type: multipart/form-data

# Get Slides
GET /api/slides

# ROI Management
POST /api/roi
GET /api/roi/:slideId
```

## 🎨 UI Components

### SlideViewer
- **Technology**: OpenSeaDragon for zoom/pan capabilities
- **Features**: ROI selection, high-resolution viewing
- **File Support**: Images and processed WSI files

### ChatPanel  
- **Features**: Message history, real-time chat
- **Integration**: ROI analysis, slide discussion

### UploadBar
- **Support**: Drag & drop, file browser
- **Types**: .svs files, images (jpg, png, etc.)
- **Processing**: Automatic thumbnail generation

## 🔄 Data Flow

1. **File Upload**: User drops file → UploadBar → API → Server processing
2. **Slide Display**: Processed files → SlideViewer → OpenSeaDragon rendering  
3. **Chat**: User input → ChatPanel → API → Response handling
4. **State Management**: App.tsx coordinates all component state

## 🧪 Available LangChain Functions

### 1. getSlideInfo
Get comprehensive information about a slide including metadata, dimensions, and analysis results.
- **Input**: `{ slideId: string }`
- **Output**: Slide metadata, dimensions, staining info, and analysis results

### 2. createROI
Create a new Region of Interest (ROI) on a slide with specified geometry.
- **Input**: `{ slideId: string, name: string, geometry: { x, y, w, h } }`
- **Output**: Created ROI with ID, coordinates, and metadata

### 3. analyzeBiologicalFeatures
Analyze biological features in a slide or ROI using various analysis types.
- **Input**: `{ slideId: string, analysisType: 'morphology'|'staining'|'cellular', roiId?: string }`
- **Output**: Detailed analysis results with metrics and insights

### 4. findSimilarSlides
Find slides similar to a given slide based on morphology, staining, or cellular patterns.
- **Input**: `{ slideId: string, similarityType: 'morphology'|'staining'|'cellular', threshold: number }`
- **Output**: List of similar slides with similarity scores

## 🧪 Testing LangChain Integration

### Test Individual Functions
```bash
cd server
node test-functions.js
```

### Test HTTP API
```bash
cd server
node test-server.js
```

### Run Demo Script
```bash
# Make executable
chmod +x demo-langchain-en.sh

# Run demo
./demo-langchain-en.sh
```

### Usage Examples

#### Natural Language Queries
```javascript
// Simple information query
"Get information about slide lung_01"

// Create ROI with analysis
"Create a ROI named tumor_region in slide lung_01 at coordinates x:150, y:250 with size 400x300, then analyze its biological features"

// Find similar slides
"Find slides similar to lung_01 based on morphological features with similarity above 80%"
```

#### Direct Function Calls
```javascript
import { langchainApi } from './lib/langchain-api';

// Get slide information
const slideInfo = await langchainApi.executeFunction('getSlideInfo', {
  slideId: 'lung_01'
});

// Create ROI
const roi = await langchainApi.executeFunction('createROI', {
  slideId: 'lung_01',
  name: 'tumor_region',
  geometry: { x: 100, y: 200, w: 300, h: 250 }
});
```

## 🚧 Planned Features

- **OpenSlide Integration**: Native .svs file processing
- **Enhanced AI Chat**: Advanced medical AI analysis with LangChain
- **Collaboration**: Multi-user slide discussion
- **Annotations**: Persistent ROI and note saving
- **Export**: Slide analysis and chat export functionality
- **Custom Function Registry**: User-defined analysis functions

## 🐛 Troubleshooting

### Port Conflicts
If you get port errors:
```bash
# Kill processes on port 5173 (frontend)
lsof -ti:5173 | xargs kill -9

# Kill processes on port 3001 (backend)
lsof -ti:3001 | xargs kill -9
```

### LangChain API Issues
- Check if OpenAI API key is set (optional, fallback mode available)
- Verify server is running on port 3001
- Test with basic functions first: `node test-functions.js`
- Run demo script to verify full functionality

### API Connection Issues
- Ensure backend is running on port 3001
- Check Vite proxy configuration in `vite.config.ts`
- Verify CORS settings in server

### Build Issues
- Clear node_modules: `rm -rf node_modules && npm install`
- Clear Vite cache: `npx vite --force`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License.

## 🤝 Contributing

### Adding New LangChain Functions
1. Define function in `server/lib/slide-functions.js`
2. Add Zod schema for validation
3. Register function with the registry
4. Test with `test-functions.js`

### Function Template
```javascript
const newFunction = {
  name: 'newFunction',
  description: 'Description of what this function does',
  tags: ['analysis', 'slides'],
  inputSchema: z.object({
    slideId: z.string(),
    // other parameters
  }),
  outputSchema: z.object({
    // expected output structure
  }),
  implementation: async (input) => {
    // function logic here
    return result;
  }
};
```

## 🙏 Acknowledgments

- **LangChain** - Framework for developing applications with language models
- **OpenAI** - GPT models for intelligent function orchestration
- **Zod** - TypeScript-first schema validation library
- **OpenSeaDragon** - High-performance web-based image viewer
- **Tailwind CSS** - Utility-first CSS framework  
- **Vite** - Fast build tool and development server
- **Express.js** - Web application framework for Node.js

---

Built with ❤️ for medical slide analysis and AI-powered collaboration.

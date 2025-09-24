# 🔬 SlideChat

A modern web application for viewing and discussing medical slides (WSI files) with an integrated chat interface. Built with React, TypeScript, and Express.js.

## 🚀 Features

- **📁 File Upload**: Support for medical slide files (.svs) and regular images
- **🔍 Slide Viewer**: High-resolution image viewing with OpenSeaDragon integration
- **💬 Chat Interface**: Interactive chat panel for slide discussion
- **🎯 ROI Selection**: Draw regions of interest on slides for focused analysis
- **📱 Responsive Design**: Modern UI built with Tailwind CSS
- **⚡ Real-time Updates**: Live file processing and chat updates

## 🏗️ Architecture

### Frontend (React + TypeScript)
- **Port**: 3000 (development)
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 3
- **Image Viewer**: OpenSeaDragon for high-resolution slides

### Backend (Node.js + Express)
- **Port**: 5050 (configurable)
- **Framework**: Express.js 5
- **File Processing**: Multer for uploads, planned OpenSlide integration
- **Static Serving**: Public slides directory

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
   npm run dev
   ```
   Server will start on `http://localhost:5050`

2. **Start the frontend** (in another terminal):
   ```bash
   cd client
   npm run dev
   ```
   Frontend will start on `http://localhost:3000`

3. **Access the application**
   Open your browser to `http://localhost:3000`

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

## 📡 API Endpoints

### Upload Slide
```http
POST /api/upload
Content-Type: multipart/form-data

# Response
{
  "id": "slide_123",
  "name": "lung_sample.svs", 
  "imageUrl": "/public/slides/slide_123/preview.jpg",
  "thumbnailUrl": "/public/slides/slide_123/thumb.jpg"
}
```

### Get Slides
```http
GET /api/slides

# Response
[
  {
    "id": "slide_123",
    "name": "lung_sample.svs",
    "imageUrl": "/public/slides/slide_123/preview.jpg", 
    "thumbnailUrl": "/public/slides/slide_123/thumb.jpg",
    "sourceType": "uploaded"
  }
]
```

### Health Check
```http
GET /api/health

# Response
{
  "status": "Server is running!"
}
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

## 🚧 Planned Features

- **OpenSlide Integration**: Native .svs file processing
- **AI Chat**: Integration with medical AI for slide analysis
- **Collaboration**: Multi-user slide discussion
- **Annotations**: Persistent ROI and note saving
- **Export**: Slide analysis and chat export functionality

## 🐛 Troubleshooting

### Port Conflicts
If you get port errors:
```bash
# Kill processes on port 3000
lsof -ti:3000 | xargs kill -9

# Kill processes on port 5050  
lsof -ti:5050 | xargs kill -9
```

### API Connection Issues
- Ensure backend is running on port 5050
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

## 🙏 Acknowledgments

- **OpenSeaDragon** - High-performance web-based image viewer
- **Tailwind CSS** - Utility-first CSS framework  
- **Vite** - Fast build tool and development server
- **Express.js** - Web application framework for Node.js

---

Built with ❤️ for medical slide analysis and collaboration.

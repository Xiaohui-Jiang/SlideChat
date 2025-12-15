# 🔬 SlideChat

An AI-powered platform for single-cell and spatial transcriptomics data analysis, combining interactive visualization with agent-based analysis capabilities.

## 📖 Overview

SlideChat enables researchers to analyze and visualize spatial transcriptomics data through an intuitive interface and AI-driven analysis agents. The platform supports data upload, interactive exploration, region of interest (ROI) selection, and automated bioinformatics workflows powered by large language models.

## ✨ Key Features

- **Interactive Visualization**: High-resolution slide viewing with OpenSeaDragon and ROI management
- **Project Management**: Organize datasets, images, and analysis results
- **AI Multiagent Analysis**: LLM-powered workflow planning for single-cell RNA-seq, spatial transcriptomics, cell typing, and differential expression
- **Real-time Chat Interface**: Natural language interaction with analysis agents
- **Automated Reporting**: Generate comprehensive reports with visualizations
- **Xenium Integration**: Built-in support for 10x Genomics Xenium spatial data

## 🏗️ Architecture

```
Frontend (React + TypeScript) - Port 3000
         ↓
Node.js Server (Express) - Port 5050
         ↓
Python Multiagent Service (FastAPI) - Port 8000
```

## 📁 Project Structure

### `client/`
Frontend application built with React and TypeScript.
- Interactive visualization interface
- Data upload and project management UI  
- Real-time communication with backend services

### `server/`
Backend server built with Node.js and Express.
- RESTful API endpoints
- File upload and processing pipeline
- Data storage and project management
- Image tile generation for visualization
- Background task queue management

### `langchain_multiagent_forfront/`
AI agent system for automated bioinformatics analysis.
- LLM-powered analysis planning (planner-executor architecture)
- Bioinformatics tools (clustering, differential expression, cell typing, spatial analysis)
- Interactive chat interface with parameter collection
- Automated report generation (text + PDF)

## 💻 Technology Stack

- **Frontend**: React 19, TypeScript 5, Vite 4, Tailwind CSS 3, OpenSeaDragon 5
- **Backend**: Node.js 20, Express 5, LangChain 0.3
- **Python Service**: FastAPI, Python 3.10+
- **AI/ML**: LangChain, OpenAI API (GPT-4o-mini), Scanpy, Squidpy, AnnData
- **Data Processing**: Sharp, Multer, NumPy, Pandas

## 🛠️ Installation

### Prerequisites
- Node.js 20+ and npm
- Python 3.10+
- Conda (recommended for Python environment)
- OpenAI API Key
- Docker (optional, for containerized deployment)

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

6. **Configure Python environment variables**
   
   Create `.env` file in the `langchain_multiagent_forfront` directory:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
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





## 📡 API Endpoints

### Key Endpoints

**Node.js Backend (Port 5050)**:
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `POST /api/upload` - Upload files
- `GET /api/projects/:projectId/images/:imageId/rois` - List ROIs
- `POST /api/xenium/analyze` - Run Xenium analysis

**Python Service (Port 8000)**:
- `POST /api/multiagent/analyze` - Submit analysis job
- `GET /api/multiagent/status/:jobId` - Check job status
- `GET /api/multiagent/result/:jobId` - Get results
- `POST /api/multiagent/chat` - General chat
- `GET /api/multiagent/download/:jobId/pdf` - Download PDF report

Full API documentation: http://localhost:8000/docs

## 💬 Using the Analysis System

1. **Create a project** and upload H5AD data file
2. **Open ChatMultiagent** interface
3. **Select data file** and analysis mode
4. **Submit analysis request** with natural language command
5. **Interact with agent** if parameters needed
6. **View results** and download reports (text/PDF)

## 👥 Contributors

- **Xiaohui Jiang** - Planner-executor architecture, tool library development, and evaluation experiments
- **Jiacheng Sang** - LangChain architecture design, AI chat interface development, API gateway routing, and backend integration
- **Tianhao Chen** - Website frontend design, backend development, and data management system


"""FastAPI wrapper for the BioAnalysisAgent multiagent system.

This API server exposes the multiagent functionality as HTTP endpoints,
allowing the SlideChat web frontend to trigger biological data analysis.

Endpoints:
- POST /api/analyze: Submit a new analysis job
- GET /api/status/{job_id}: Check job status
- GET /api/result/{job_id}: Get job result

Run with:
    uvicorn api:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

# Configure matplotlib to use non-interactive backend BEFORE any other imports
import matplotlib
matplotlib.use('Agg')

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field

# Import the multiagent system
from agent import (
    BioAnalysisAgent,
    AnalysisResult,
    create_plan_builder,
    resolve_dataset_path,
)
from chat_user_io import HybridChatUserIO
from interactive_user_io import InteractiveUserIO

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Biological Multiagent Analysis API",
    description="API for running biological data analysis workflows",
    version="1.0.0"
)

# Configure CORS for web frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store (in production, use Redis or database)
jobs: Dict[str, Dict[str, Any]] = {}
JOB_RESULTS_DIR = Path("./job_results")
JOB_RESULTS_DIR.mkdir(exist_ok=True)

# Chat conversation memory store (session_id -> list of messages)
chat_conversations: Dict[str, list] = {}


# ============================================================================
# Request/Response Models
# ============================================================================

class AnalysisRequest(BaseModel):
    """Request body for starting a new analysis."""
    
    data_path: str = Field(
        ...,
        description="Path to the dataset file (.h5ad or .h5)",
        example="./data/sample.h5ad"
    )
    command: str = Field(
        default="Perform comprehensive single-cell analysis",
        description="High-level analysis command",
        example="Analyze cell types and spatial patterns in this lung tissue sample"
    )
    planner: str = Field(
        default="llm",
        description="Planner type: 'llm' or 'static'",
        example="llm"
    )
    include_steps: Optional[list[str]] = Field(
        default=None,
        description="Optional step identifiers to force include",
        example=["cell_typing", "spatial_domain"]
    )
    auto_mode: bool = Field(
        default=True,
        description="Run in non-interactive mode (auto-accept defaults). Set to False for interactive chat mode.",
        example=True
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Chat session ID for linking job to conversation context",
        example="550e8400-e29b-41d4-a716-446655440000"
    )


class UserResponse(BaseModel):
    """User response to an agent question."""
    
    message_id: str = Field(
        ...,
        description="ID of the message being responded to"
    )
    response: str = Field(
        ...,
        description="User's response text"
    )


class JobStatusResponse(BaseModel):
    """Response for job status query."""
    
    job_id: str
    status: str  # 'pending', 'running', 'completed', 'failed'
    progress: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None


class JobResultResponse(BaseModel):
    """Response for job result query."""
    
    job_id: str
    status: str
    report_url: Optional[str] = None
    pdf_url: Optional[str] = None
    log_url: Optional[str] = None
    summary: Optional[str] = None
    error: Optional[str] = None


# ============================================================================
# Background Job Runner
# ============================================================================

class AutoUserIO:
    """Non-interactive UserIO that accepts all defaults."""
    
    def display(self, message: str) -> None:
        logger.info(f"[AGENT] {message}")
    
    def prompt(self, message: str) -> str:
        logger.info(f"[PROMPT] {message} -> [AUTO] Using default")
        return ""
    
    def confirm(self, message: str, default: bool = True) -> bool:
        decision = "accept" if default else "decline"
        logger.info(f"[CONFIRM] {message} -> [AUTO] {decision}")
        return default


async def run_analysis_job(job_id: str, request: AnalysisRequest):
    """Run the analysis in background."""
    
    try:
        jobs[job_id]["status"] = "running"
        jobs[job_id]["started_at"] = datetime.now().isoformat()
        
        logger.info(f"Starting analysis job {job_id} (interactive={not request.auto_mode})")
        
        # Prepare context
        planner_context = {
            "adata_path": request.data_path,
            "extra_context": request.command,
            "required_steps": request.include_steps or [],
        }
        
        # Create plan builder
        plan_builder = create_plan_builder(
            request.planner,
            request.include_steps,
            planner_context
        )
        
        # Create appropriate UserIO based on mode
        if request.auto_mode:
            # Non-interactive mode: auto-answer all questions
            user_io = HybridChatUserIO(job_id=job_id)
            logger.info(f"Job {job_id}: Using HybridChatUserIO (auto mode)")
        else:
            # Interactive mode: wait for user responses
            user_io = InteractiveUserIO(job_id=job_id, timeout=300.0)
            logger.info(f"Job {job_id}: Using InteractiveUserIO (interactive mode)")
        
        agent = BioAnalysisAgent(user_io=user_io, plan_builder=plan_builder)
        
        # Store user_io reference for message retrieval and response submission
        jobs[job_id]["user_io"] = user_io
        jobs[job_id]["interactive"] = not request.auto_mode
        
        # Run analysis in a separate thread to avoid blocking the event loop
        import asyncio
        result: AnalysisResult = await asyncio.to_thread(agent.run, request.command)
        
        # Save result
        job_result_dir = JOB_RESULTS_DIR / job_id
        job_result_dir.mkdir(exist_ok=True)
        
        # Copy result files to job directory
        import shutil
        if result.report_path.exists():
            shutil.copy(result.report_path, job_result_dir / "report.txt")
        if result.pdf_path.exists():
            shutil.copy(result.pdf_path, job_result_dir / "figures.pdf")
        if result.log_path.exists():
            shutil.copy(result.log_path, job_result_dir / "log.json")
        
        # Generate summary from last log entry
        summary = None
        if result.logs:
            last_log = result.logs[-1]
            summary = f"{last_log.step_title}: {last_log.summary or last_log.status}"
        
        # Update job status
        jobs[job_id].update({
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "result": {
                "report_path": str(job_result_dir / "report.txt"),
                "pdf_path": str(job_result_dir / "figures.pdf"),
                "log_path": str(job_result_dir / "log.json"),
                "summary": summary,
            }
        })
        
        logger.info(f"Job {job_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Job {job_id} failed: {str(e)}", exc_info=True)
        jobs[job_id].update({
            "status": "failed",
            "completed_at": datetime.now().isoformat(),
            "error": str(e)
        })


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "Biological Multiagent Analysis API",
        "status": "running",
        "version": "1.0.0"
    }


@app.post("/api/analyze", response_model=Dict[str, str])
async def create_analysis_job(
    request: AnalysisRequest,
    background_tasks: BackgroundTasks
):
    """
    Submit a new analysis job.
    
    Returns immediately with a job_id that can be used to check status.
    """
    
    # Validate data path
    data_path = Path(request.data_path).expanduser().resolve()
    if not data_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Data file not found: {request.data_path}"
        )
    
    # Create job
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "request": request.dict(),
        "session_id": request.session_id,  # Link to chat session
        "created_at": datetime.now().isoformat(),
        "started_at": None,
        "completed_at": None,
        "error": None,
        "result": None,
    }
    
    # Start background task
    background_tasks.add_task(run_analysis_job, job_id, request)
    
    logger.info(f"Created analysis job {job_id}")
    
    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Analysis job created successfully"
    }


@app.get("/api/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """
    Get the status of an analysis job.
    """
    
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    
    return JobStatusResponse(
        job_id=job_id,
        status=job["status"],
        progress=job.get("progress"),
        created_at=job["created_at"],
        started_at=job.get("started_at"),
        completed_at=job.get("completed_at"),
        error=job.get("error")
    )


@app.get("/api/result/{job_id}", response_model=JobResultResponse)
async def get_job_result(job_id: str):
    """
    Get the result of a completed analysis job.
    """
    
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    
    if job["status"] not in ["completed", "failed"]:
        raise HTTPException(
            status_code=400,
            detail=f"Job is not ready. Current status: {job['status']}"
        )
    
    result = job.get("result", {})
    
    # Return URLs pointing to Node proxy server (port 5050)
    base_url = "http://localhost:5050/api/multiagent/download"
    
    return JobResultResponse(
        job_id=job_id,
        status=job["status"],
        report_url=f"{base_url}/{job_id}/report" if result.get("report_path") else None,
        pdf_url=f"{base_url}/{job_id}/pdf" if result.get("pdf_path") else None,
        log_url=f"{base_url}/{job_id}/log" if result.get("log_path") else None,
        summary=result.get("summary"),
        error=job.get("error")
    )


@app.get("/api/download/{job_id}/{file_type}")
async def download_file(job_id: str, file_type: str):
    """
    Download result files (report, pdf, or log).
    """
    
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")
    
    result = job.get("result", {})
    
    file_map = {
        "report": ("report_path", "analysis_report.txt", "text/plain"),
        "pdf": ("pdf_path", "analysis_figures.pdf", "application/pdf"),
        "log": ("log_path", "analysis_log.json", "application/json"),
    }
    
    if file_type not in file_map:
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    path_key, filename, media_type = file_map[file_type]
    file_path = result.get(path_key)
    
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(
        file_path,
        media_type=media_type,
        filename=filename
    )


@app.get("/api/jobs")
async def list_jobs():
    """
    List all jobs with their current status.
    """
    
    return {
        "jobs": [
            {
                "job_id": job_id,
                "status": job["status"],
                "created_at": job["created_at"],
                "command": job["request"]["command"],
                "session_id": job.get("session_id"),
            }
            for job_id, job in jobs.items()
        ]
    }


@app.get("/api/session/{session_id}/jobs")
async def get_session_jobs(session_id: str):
    """
    Get all jobs linked to a specific chat session.
    """
    
    session_jobs = [
        {
            "job_id": job_id,
            "status": job["status"],
            "created_at": job["created_at"],
            "command": job["request"]["command"],
        }
        for job_id, job in jobs.items()
        if job.get("session_id") == session_id
    ]
    
    return {"session_id": session_id, "jobs": session_jobs}


@app.get("/api/messages/{job_id}")
async def get_job_messages(job_id: str):
    """
    Get interaction messages from a running or completed job.
    This allows the frontend to display agent's questions and prompts.
    """
    
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    user_io = job.get("user_io")
    
    if not user_io:
        return {"messages": [], "step_messages": [], "pending": None}
    
    # Support both HybridChatUserIO and InteractiveUserIO
    if isinstance(user_io, HybridChatUserIO):
        return {
            "messages": user_io.get_messages(),
            "step_messages": user_io.get_step_messages(),
            "pending": None
        }
    elif isinstance(user_io, InteractiveUserIO):
        return {
            "messages": user_io.get_messages(),
            "step_messages": [],
            "pending": user_io.get_pending_message()
        }
    
    return {"messages": [], "step_messages": [], "pending": None}


@app.post("/api/response/{job_id}")
async def submit_user_response(job_id: str, response: UserResponse):
    """
    Submit a user response to a pending question.
    Used in interactive mode when agent is waiting for user input.
    """
    
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    
    if not job.get("interactive"):
        raise HTTPException(
            status_code=400,
            detail="Job is not in interactive mode"
        )
    
    user_io = job.get("user_io")
    
    if not user_io or not isinstance(user_io, InteractiveUserIO):
        raise HTTPException(
            status_code=400,
            detail="Job does not support responses"
        )
    
    success = user_io.submit_response(response.message_id, response.response)
    
    if not success:
        raise HTTPException(
            status_code=400,
            detail="Failed to submit response (message not found or already answered)"
        )
    
    return {
        "message": "Response submitted successfully",
        "message_id": response.message_id
    }


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    """
    Delete a job and its results.
    """
    
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Delete result files
    job_result_dir = JOB_RESULTS_DIR / job_id
    if job_result_dir.exists():
        import shutil
        shutil.rmtree(job_result_dir)
    
    # Remove from jobs dict
    del jobs[job_id]
    
    return {"message": f"Job {job_id} deleted successfully"}


@app.post("/api/chat")
async def simple_chat(request: dict):
    """
    Simple chat endpoint for general conversation with GPT.
    Used when user is not in an active analysis.
    Maintains conversation history per session.
    """
    
    message = request.get("message", "").strip()
    session_id = request.get("session_id", "default")  # Session ID for memory
    current_job = request.get("current_job")  # { job_id, job_name } from frontend
    
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
        
        # Get API key
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return {
                "response": "I'm your Biological Analysis Assistant. I can help you analyze single-cell data. Type 'start' to begin an analysis!",
                "session_id": session_id
            }
        
        # Initialize conversation history for this session if not exists
        if session_id not in chat_conversations:
            chat_conversations[session_id] = []
        
        conversation_history = chat_conversations[session_id]
        
        # Find jobs linked to this session for context
        session_jobs = [
            {
                "job_id": job_id,
                "status": job["status"],
                "command": job["request"]["command"],
                "created_at": job["created_at"]
            }
            for job_id, job in jobs.items()
            if job.get("session_id") == session_id
        ]
        
        # Build context about active jobs
        job_context = ""
        
        # Prioritize current_job from frontend if provided
        if current_job and current_job.get("job_id"):
            job_id = current_job["job_id"]
            job_name = current_job.get("job_name", job_id[:8])
            
            if job_id in jobs:
                job = jobs[job_id]
                job_status = job["status"]
                job_command = job["request"]["command"]
                
                if job_status in ["running", "pending"]:
                    job_context += f"\n\nCurrent active analysis:\n- Job: {job_name}\n- Command: {job_command}\n- Status: {job_status}"
                elif job_status == "completed":
                    job_context += f"\n\nMost recent completed job:\n- Job: {job_name}\n- Command: {job_command}"
                    
                    # Add detailed results if available
                    if job.get("result"):
                        result = job["result"]
                        if result.get("summary"):
                            job_context += f"\n- Summary: {result['summary']}"
                        
                        # Include log data for detailed context
                        if result.get("log_path"):
                            try:
                                import json
                                with open(result["log_path"], 'r') as f:
                                    log_data = json.load(f)
                                    if "steps" in log_data and log_data["steps"]:
                                        last_step = log_data["steps"][-1]
                                        if "summary" in last_step:
                                            job_context += f"\n- Details: {last_step['summary']}"
                            except Exception as e:
                                logger.warning(f"Could not read log file: {e}")
        else:
            # Fall back to session-based job lookup
            if session_jobs:
                active_jobs = [j for j in session_jobs if j["status"] in ["running", "pending"]]
                completed_jobs = [j for j in session_jobs if j["status"] == "completed"]
                
                if active_jobs:
                    job_info = active_jobs[0]  # Most relevant is first
                    job_context += f"\n\nCurrent active analysis job:\n- Job ID: {job_info['job_id'][:8]}\n- Command: {job_info['command']}\n- Status: {job_info['status']}"
                elif completed_jobs:
                    job_info = completed_jobs[-1]  # Most recent completed
                    job_id = job_info['job_id']
                    job_context += f"\n\nMost recent completed job:\n- Job ID: {job_id[:8]}\n- Command: {job_info['command']}"
                    
                    # Add detailed results if available
                    if job_id in jobs and jobs[job_id].get("result"):
                        result = jobs[job_id]["result"]
                        if result.get("summary"):
                            job_context += f"\n- Summary: {result['summary']}"
                        
                        # Include log data for detailed context
                        if result.get("log_path"):
                            try:
                                import json
                                with open(result["log_path"], 'r') as f:
                                    log_data = json.load(f)
                                    if "steps" in log_data and log_data["steps"]:
                                        last_step = log_data["steps"][-1]
                                        if "summary" in last_step:
                                            job_context += f"\n- Details: {last_step['summary']}"
                            except Exception as e:
                                logger.warning(f"Could not read log file: {e}")
        
        llm = ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0.7,
            openai_api_key=api_key
        )
        
        system_prompt = f"""You are a helpful Biological Analysis Assistant specialized in single-cell data analysis.
You help users analyze their biological data using advanced bioinformatics tools.

When users ask questions about their analysis, use the detailed context provided below to give specific, accurate answers with numbers and statistics.
If they ask general questions, answer them naturally and helpfully.

Your capabilities:
- Analyze single-cell RNA-seq data (.h5 format)
- Perform cell type identification
- Conduct spatial domain analysis
- Generate quality control reports
- Create visualizations and comprehensive PDF reports

Be friendly, concise, and provide specific numbers when available.
Remember the conversation history and refer to previous messages when relevant.{job_context}"""
        
        # Build message list with history
        messages = [SystemMessage(content=system_prompt)]
        
        # Add conversation history (limit to last 10 exchanges to avoid token limits)
        max_history = 20  # 10 user + 10 assistant messages
        history_to_include = conversation_history[-max_history:] if len(conversation_history) > max_history else conversation_history
        messages.extend(history_to_include)
        
        # Add current user message
        messages.append(HumanMessage(content=message))
        
        # Get response from LLM
        response = llm.invoke(messages)
        
        # Store in conversation history
        conversation_history.append(HumanMessage(content=message))
        conversation_history.append(AIMessage(content=response.content))
        
        # Keep conversation history manageable (max 50 messages total)
        if len(conversation_history) > 50:
            conversation_history[:] = conversation_history[-50:]
        
        return {
            "response": response.content,
            "session_id": session_id,
            "history_length": len(conversation_history)
        }
        
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return {
            "response": "I'm your Biological Analysis Assistant. Type 'start' to begin an analysis!",
            "session_id": session_id
        }


@app.delete("/api/chat/{session_id}")
async def clear_chat_history(session_id: str):
    """
    Clear conversation history for a specific session.
    """
    
    if session_id in chat_conversations:
        del chat_conversations[session_id]
        return {
            "message": f"Chat history cleared for session {session_id}",
            "session_id": session_id
        }
    else:
        return {
            "message": "No chat history found for this session",
            "session_id": session_id
        }


@app.get("/api/chat/{session_id}/history")
async def get_chat_history(session_id: str):
    """
    Get conversation history for a specific session.
    """
    
    if session_id not in chat_conversations:
        return {
            "session_id": session_id,
            "history": [],
            "message_count": 0
        }
    
    history = chat_conversations[session_id]
    formatted_history = []
    
    for msg in history:
        formatted_history.append({
            "role": "user" if msg.__class__.__name__ == "HumanMessage" else "assistant",
            "content": msg.content
        })
    
    return {
        "session_id": session_id,
        "history": formatted_history,
        "message_count": len(formatted_history)
    }


# ============================================================================
# Startup/Shutdown Events
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize on startup."""
    logger.info("🚀 Biological Multiagent Analysis API started")
    logger.info(f"📁 Job results directory: {JOB_RESULTS_DIR.absolute()}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("👋 Biological Multiagent Analysis API shutting down")


if __name__ == "__main__":
    import uvicorn
    
    # Load OpenAI API key from server/.env if not already set
    if not os.environ.get("OPENAI_API_KEY"):
        env_file = Path(__file__).parent.parent / "server" / ".env"
        if env_file.exists():
            with open(env_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("OPENAI_API_KEY="):
                        key = line.split("=", 1)[1].strip()
                        os.environ["OPENAI_API_KEY"] = key
                        logger.info("✅ Loaded OPENAI_API_KEY from server/.env")
                        break
    
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

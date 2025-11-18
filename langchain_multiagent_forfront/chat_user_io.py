"""
WebSocket-based User IO for interactive chat interface.
"""
from typing import Optional, Dict, Any
import asyncio
import json
from datetime import datetime
import uuid


class ChatUserIO:
    """
    User IO implementation that communicates through a message queue
    for integration with chat interfaces.
    """
    
    def __init__(self, job_id: str, message_callback=None):
        """
        Args:
            job_id: Unique identifier for this analysis job
            message_callback: Async function to send messages to frontend
        """
        self.job_id = job_id
        self.message_callback = message_callback
        self.pending_response = None
        self.response_event = asyncio.Event()
        
    async def _send_message(self, message: str, message_type: str = "info", requires_response: bool = False):
        """Send a message to the frontend."""
        msg = {
            "id": str(uuid.uuid4()),
            "job_id": self.job_id,
            "type": message_type,
            "content": message,
            "timestamp": datetime.now().isoformat(),
            "requires_response": requires_response
        }
        
        if self.message_callback:
            await self.message_callback(msg)
        
        return msg["id"]
    
    async def _wait_for_response(self, timeout: float = 300.0) -> str:
        """Wait for user response from frontend."""
        try:
            await asyncio.wait_for(self.response_event.wait(), timeout=timeout)
            self.response_event.clear()
            response = self.pending_response
            self.pending_response = None
            return response
        except asyncio.TimeoutError:
            # Return default value on timeout
            return ""
    
    def receive_response(self, response: str):
        """Called by API endpoint when user sends a response."""
        self.pending_response = response
        self.response_event.set()
    
    def display(self, message: str) -> None:
        """Display a message to the user (non-blocking)."""
        # In sync context, we need to handle this differently
        # Store message for batch sending
        if hasattr(self, '_message_queue'):
            self._message_queue.append({
                "type": "info",
                "content": message,
                "timestamp": datetime.now().isoformat()
            })
        else:
            # Fallback to print for now
            print(f"[CHAT] {message}")
    
    def prompt(self, message: str) -> str:
        """
        Prompt user for input (blocking in async context).
        In non-async context, returns empty string (auto mode).
        """
        # For now, return empty to trigger auto-behavior
        # Full async implementation requires refactoring the agent
        print(f"[CHAT PROMPT] {message}")
        return ""
    
    def confirm(self, message: str, default: bool = True) -> bool:
        """
        Ask user for confirmation (blocking in async context).
        In non-async context, returns default.
        """
        print(f"[CHAT CONFIRM] {message} (default: {default})")
        return default


class InteractiveChatUserIO(ChatUserIO):
    """
    Enhanced version that properly handles async interactions.
    Requires agent to be refactored for async/await.
    """
    
    async def display_async(self, message: str) -> None:
        """Async version of display."""
        await self._send_message(message, message_type="info")
    
    async def prompt_async(self, message: str) -> str:
        """Async version of prompt."""
        msg_id = await self._send_message(message, message_type="prompt", requires_response=True)
        response = await self._wait_for_response()
        return response
    
    async def confirm_async(self, message: str, default: bool = True) -> bool:
        """Async version of confirm."""
        prompt_msg = f"{message} [{'Y/n' if default else 'y/N'}]"
        msg_id = await self._send_message(prompt_msg, message_type="confirm", requires_response=True)
        response = await self._wait_for_response()
        
        if not response:
            return default
        
        response = response.strip().lower()
        if response in {"y", "yes", "true", "1"}:
            return True
        elif response in {"n", "no", "false", "0"}:
            return False
        else:
            return default


# Temporary compatibility layer until agent is refactored
class HybridChatUserIO(ChatUserIO):
    """
    Hybrid implementation that collects messages during sync execution
    and sends them in batches.
    """
    
    def __init__(self, job_id: str, message_callback=None):
        super().__init__(job_id, message_callback)
        self._message_queue = []
        self._step_messages = []
    
    def display(self, message: str) -> None:
        """Collect display messages."""
        self._message_queue.append({
            "type": "info",
            "content": message,
            "timestamp": datetime.now().isoformat()
        })
    
    def prompt(self, message: str) -> str:
        """Store prompt and return empty (auto mode)."""
        self._message_queue.append({
            "type": "prompt",
            "content": message,
            "timestamp": datetime.now().isoformat(),
            "auto_answered": True
        })
        return ""  # Auto mode
    
    def confirm(self, message: str, default: bool = True) -> bool:
        """Store confirmation and return default."""
        self._message_queue.append({
            "type": "confirm",
            "content": message,
            "default": default,
            "timestamp": datetime.now().isoformat(),
            "auto_answered": True
        })
        return default
    
    def get_messages(self) -> list:
        """Get all collected messages."""
        messages = self._message_queue.copy()
        self._message_queue.clear()
        return messages
    
    def add_step_message(self, step_name: str, status: str, details: str = ""):
        """Add a step progress message."""
        self._step_messages.append({
            "type": "step",
            "step": step_name,
            "status": status,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })
    
    def get_step_messages(self) -> list:
        """Get all step messages."""
        messages = self._step_messages.copy()
        self._step_messages.clear()
        return messages

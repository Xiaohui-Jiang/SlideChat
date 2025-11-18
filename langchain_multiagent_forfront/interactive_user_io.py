"""Interactive UserIO for web-based chat interactions.

This module provides a UserIO implementation that enables true interactive
conversations between the agent and users through a web interface.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class InteractionMessage:
    """A message in the interaction flow."""
    type: str  # 'display', 'prompt', 'confirm', 'step'
    content: str
    timestamp: str
    message_id: str
    # For prompts and confirms
    requires_response: bool = False
    response: Optional[str] = None
    responded_at: Optional[str] = None
    # For step messages
    step: Optional[str] = None
    status: Optional[str] = None
    details: Optional[str] = None
    # For confirms
    default: Optional[bool] = None


class InteractiveUserIO:
    """UserIO that enables real-time web-based interactions.
    
    This implementation:
    1. Collects all agent messages (display, prompt, confirm)
    2. Blocks and waits for user responses when needed
    3. Allows the frontend to poll for pending questions
    4. Receives user responses through an API endpoint
    """
    
    def __init__(self, job_id: str, timeout: float = 300.0):
        """Initialize interactive UserIO.
        
        Args:
            job_id: Unique identifier for this job
            timeout: Maximum time to wait for user response (seconds)
        """
        self.job_id = job_id
        self.timeout = timeout
        self._messages: List[InteractionMessage] = []
        self._pending_response: Optional[InteractionMessage] = None
        self._response_event: Optional[asyncio.Event] = None
        
    def _create_message(
        self,
        msg_type: str,
        content: str,
        requires_response: bool = False,
        **kwargs
    ) -> InteractionMessage:
        """Create a new interaction message."""
        msg = InteractionMessage(
            type=msg_type,
            content=content,
            timestamp=datetime.now().isoformat(),
            message_id=f"{self.job_id}_{len(self._messages)}",
            requires_response=requires_response,
            **kwargs
        )
        self._messages.append(msg)
        logger.info(f"[{self.job_id}] Created message: {msg_type} - {content[:50]}...")
        return msg
    
    def display(self, message: str) -> None:
        """Display an information message."""
        self._create_message('display', message)
        print(f"[AGENT] {message}")
    
    def prompt(self, message: str) -> str:
        """Prompt the user for input and wait for response.
        
        This method BLOCKS until the user provides a response through the API.
        """
        msg = self._create_message('prompt', message, requires_response=True)
        self._pending_response = msg
        
        print(f"[PROMPT] {message}")
        print(f"[WAITING] Job {self.job_id} is waiting for user input...")
        
        # Wait for response (synchronous blocking)
        start_time = time.time()
        while msg.response is None:
            time.sleep(0.5)
            if time.time() - start_time > self.timeout:
                logger.warning(f"[{self.job_id}] Prompt timeout, using empty response")
                msg.response = ""
                msg.responded_at = datetime.now().isoformat()
                break
        
        self._pending_response = None
        response = msg.response or ""
        print(f"[RESPONSE] {response}")
        return response
    
    def confirm(self, message: str, default: bool = True) -> bool:
        """Ask for confirmation and wait for response.
        
        This method BLOCKS until the user provides a response through the API.
        """
        msg = self._create_message(
            'confirm',
            message,
            requires_response=True,
            default=default
        )
        self._pending_response = msg
        
        suffix = "[Y/n]" if default else "[y/N]"
        print(f"[CONFIRM] {message} {suffix}")
        print(f"[WAITING] Job {self.job_id} is waiting for confirmation...")
        
        # Wait for response (synchronous blocking)
        start_time = time.time()
        while msg.response is None:
            time.sleep(0.5)
            if time.time() - start_time > self.timeout:
                logger.warning(f"[{self.job_id}] Confirm timeout, using default: {default}")
                msg.response = "yes" if default else "no"
                msg.responded_at = datetime.now().isoformat()
                break
        
        self._pending_response = None
        response = (msg.response or "").strip().lower()
        
        if not response:
            result = default
        elif response in {"y", "yes", "true", "1"}:
            result = True
        elif response in {"n", "no", "false", "0"}:
            result = False
        else:
            result = default
        
        print(f"[RESPONSE] {'Yes' if result else 'No'}")
        return result
    
    def submit_response(self, message_id: str, response: str) -> bool:
        """Submit a user response to a pending question.
        
        Args:
            message_id: ID of the message being responded to
            response: User's response text
            
        Returns:
            True if response was accepted, False otherwise
        """
        # Find the message
        for msg in self._messages:
            if msg.message_id == message_id and msg.requires_response:
                if msg.response is None:
                    msg.response = response
                    msg.responded_at = datetime.now().isoformat()
                    logger.info(f"[{self.job_id}] Response received: {response}")
                    return True
                else:
                    logger.warning(f"[{self.job_id}] Message already responded to")
                    return False
        
        logger.warning(f"[{self.job_id}] Message not found: {message_id}")
        return False
    
    def get_messages(self) -> List[Dict[str, Any]]:
        """Get all interaction messages."""
        return [asdict(msg) for msg in self._messages]
    
    def get_pending_message(self) -> Optional[Dict[str, Any]]:
        """Get the currently pending message that needs a response."""
        if self._pending_response:
            return asdict(self._pending_response)
        return None
    
    def add_step_message(self, step: str, status: str, details: str = ""):
        """Add a step progress message."""
        self._create_message(
            'step',
            f"{step}: {status}",
            step=step,
            status=status,
            details=details
        )

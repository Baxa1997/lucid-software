# ─────────────────────────────────────────────────────────────
#  Lucid AI — AI Agent Engine
#  FastAPI + OpenHands Software Agent SDK V1
#  CodeActAgent · Docker-Sandboxed Execution · WebSocket Events
# ─────────────────────────────────────────────────────────────

import os
import sys
import uuid
import time
import asyncio
import logging
import subprocess
import threading
import json
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env file

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, SecretStr

# ── OpenHands SDK V1 Imports ────────────────────────────────
# Four-package architecture:
#   openhands-sdk       → LLM, Agent, Conversation, Tool, Workspace
#   openhands-tools     → TerminalTool, FileEditorTool, TaskTrackerTool
#   openhands-workspace → DockerWorkspace, RemoteWorkspace
#   openhands-agent-server → ManagedAPIServer

try:
    from openhands.sdk import (
        LLM,
        Agent,
        Conversation,
        Tool,
        Workspace,
        get_logger,
    )
    from openhands.sdk.conversation import RemoteConversation
    from openhands.sdk.event import ConversationStateUpdateEvent
    from openhands.tools.file_editor import FileEditorTool
    from openhands.tools.task_tracker import TaskTrackerTool
    from openhands.tools.terminal import TerminalTool
    from openhands.tools.preset.default import get_default_agent

    OPENHANDS_AVAILABLE = True
except ImportError as e:
    OPENHANDS_AVAILABLE = False
    _import_error = str(e)

# ═══════════════════════════════════════════════════════════
#  Logging
# ═══════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-7s │ %(name)s │ %(message)s",
)
logger = logging.getLogger("lucid.ai_engine")

# ═══════════════════════════════════════════════════════════
#  Configuration
# ═══════════════════════════════════════════════════════════

# LLM Config — Per-Provider
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")  # Legacy fallback
LLM_BASE_URL = os.getenv("LLM_BASE_URL", None)

# Provider-specific model names (LiteLLM convention: provider/model)
MODEL_CONFIGS = {
    "google": {
        "model": "gemini/gemini-3-flash-preview",
        "env_key": "GOOGLE_API_KEY",
        "label": "Gemini 3 Flash Preview",
    },
    "anthropic": {
        "model": "anthropic/claude-3-5-sonnet-20241022",
        "env_key": "ANTHROPIC_API_KEY",
        "label": "Claude 3.5 Sonnet",
    },
}
DEFAULT_PROVIDER = os.getenv("DEFAULT_MODEL_PROVIDER", "anthropic")

# Agent Config
MAX_ITERATIONS = int(os.getenv("MAX_ITERATIONS", "50"))
AGENT_SERVER_PORT = int(os.getenv("AGENT_SERVER_PORT", "8001"))
AGENT_SERVER_HOST = os.getenv("AGENT_SERVER_HOST", "127.0.0.1")

# Sandbox Config
SANDBOX_IMAGE = os.getenv(
    "SANDBOX_IMAGE",
    "nikolaik/python-nodejs:python3.11-nodejs20"
)
WORKSPACE_MOUNT_PATH = os.getenv("WORKSPACE_MOUNT_PATH", "/workspace")

# Server Config
SESSION_SECRET = os.getenv("SESSION_SECRET", "change_me_in_prod")
PORT = int(os.getenv("PORT", "8000"))

# Gemini Safety Settings — disable all content filters for coding agents
# (prevents refusals on generated code that "looks like hacking")
GEMINI_SAFETY_SETTINGS = [
    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
]

# ═══════════════════════════════════════════════════════════
#  Session Store
# ═══════════════════════════════════════════════════════════


class AgentSession:
    """
    Encapsulates a single user's agent session.

    Holds the Conversation, Workspace, and streaming state
    needed to drive the CodeActAgent loop and relay events
    back to the frontend over WebSocket.
    """

    def __init__(
        self,
        session_id: str,
        user_id: str,
        task: str,
        repo_url: Optional[str] = None,
    ):
        self.session_id = session_id
        self.user_id = user_id
        self.task = task
        self.repo_url = repo_url
        self.created_at = datetime.now(timezone.utc)
        self.is_alive = True

        # SDK objects — set during initialization
        self.conversation: Optional[Any] = None
        self.workspace: Optional[Any] = None
        self.agent: Optional[Any] = None
        self.llm: Optional[Any] = None

        # Event buffer for WebSocket streaming
        self.event_buffer: asyncio.Queue = asyncio.Queue()


# Global store: session_id → AgentSession
active_sessions: Dict[str, AgentSession] = {}
_session_lock = asyncio.Lock()


# ═══════════════════════════════════════════════════════════
#  ManagedAPIServer (for Docker-sandboxed execution)
# ═══════════════════════════════════════════════════════════


class ManagedAgentServer:
    """
    Context manager that spawns `python -m openhands.agent_server`
    as a subprocess. The agent-server provides Docker-sandboxed
    execution via RemoteWorkspace/RemoteConversation.

    In production, this would be a separate service (K8s pod, etc.).
    For local dev, we manage it as a subprocess.
    """

    def __init__(
        self,
        port: int = AGENT_SERVER_PORT,
        host: str = AGENT_SERVER_HOST,
    ):
        self.port = port
        self.host = host
        self.process: Optional[subprocess.Popen] = None
        self.base_url = f"http://{host}:{port}"
        self._stdout_thread: Optional[threading.Thread] = None
        self._stderr_thread: Optional[threading.Thread] = None

    def _stream_output(self, stream, prefix, target_stream):
        """Relay subprocess output to our logs."""
        try:
            for line in iter(stream.readline, ""):
                if line:
                    target_stream.write(f"[{prefix}] {line}")
                    target_stream.flush()
        except Exception as e:
            logger.error(f"Error streaming {prefix}: {e}")
        finally:
            stream.close()

    def start(self) -> bool:
        """Start the agent server subprocess."""
        if not OPENHANDS_AVAILABLE:
            logger.warning("OpenHands SDK not available — skipping agent server")
            return False

        logger.info(f"🚀 Starting OpenHands Agent Server on {self.base_url}...")

        try:
            self.process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "openhands.agent_server",
                    "--port",
                    str(self.port),
                    "--host",
                    self.host,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={"LOG_JSON": "true", **os.environ},
            )

            # Stream server output
            self._stdout_thread = threading.Thread(
                target=self._stream_output,
                args=(self.process.stdout, "AGENT-SERVER", sys.stdout),
                daemon=True,
            )
            self._stderr_thread = threading.Thread(
                target=self._stream_output,
                args=(self.process.stderr, "AGENT-SERVER", sys.stderr),
                daemon=True,
            )
            self._stdout_thread.start()
            self._stderr_thread.start()

            # Wait for server readiness
            max_retries = 30
            for i in range(max_retries):
                try:
                    import httpx

                    response = httpx.get(
                        f"{self.base_url}/health", timeout=1.0
                    )
                    if response.status_code == 200:
                        logger.info(
                            f"✅ Agent Server ready at {self.base_url}"
                        )
                        return True
                except Exception:
                    pass

                if self.process.poll() is not None:
                    logger.error(
                        "❌ Agent Server terminated unexpectedly"
                    )
                    return False

                time.sleep(1)

            logger.error(
                f"❌ Agent Server failed to start after {max_retries}s"
            )
            return False

        except Exception as e:
            logger.error(f"❌ Failed to start Agent Server: {e}")
            return False

    def stop(self):
        """Stop the agent server subprocess."""
        if self.process:
            logger.info("🛑 Stopping Agent Server...")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("⚠️  Force-killing Agent Server...")
                self.process.kill()
                self.process.wait()
            time.sleep(0.5)
            logger.info("✅ Agent Server stopped.")


# Global agent server instance
_agent_server = ManagedAgentServer()


# ═══════════════════════════════════════════════════════════
#  FastAPI Lifespan
# ═══════════════════════════════════════════════════════════


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Start the OpenHands Agent Server on boot,
    and clean up all sessions + server on shutdown.
    """
    logger.info("🚀 Lucid AI Engine starting...")

    # Start the sandboxed agent server (non-blocking)
    if OPENHANDS_AVAILABLE and LLM_API_KEY:
        server_started = await asyncio.to_thread(_agent_server.start)
        if server_started:
            logger.info("✅ Agent Server subprocess is running")
        else:
            logger.warning(
                "⚠️  Agent Server not started — running in local/mock mode"
            )
    else:
        if not OPENHANDS_AVAILABLE:
            logger.warning(
                f"⚠️  OpenHands SDK not installed: {_import_error if not OPENHANDS_AVAILABLE else 'N/A'}"
            )
        if not LLM_API_KEY:
            logger.warning("⚠️  LLM_API_KEY not set — agent will not function")

    yield

    # Shutdown: destroy all sessions
    logger.info("🛑 Shutting down — cleaning up sessions...")
    for session_id in list(active_sessions.keys()):
        await _destroy_session(session_id)

    # Stop agent server
    await asyncio.to_thread(_agent_server.stop)
    logger.info("✅ All resources cleaned up.")


# ═══════════════════════════════════════════════════════════
#  FastAPI App
# ═══════════════════════════════════════════════════════════

app = FastAPI(
    title="Lucid AI Engine",
    description=(
        "AI Agent microservice powered by the OpenHands Software Agent SDK V1. "
        "Runs CodeActAgent in Docker-sandboxed workspaces with real-time "
        "WebSocket event streaming."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════
#  Pydantic Models
# ═══════════════════════════════════════════════════════════


class InitSessionRequest(BaseModel):
    """Payload from the frontend to start an agent session."""
    token: Optional[str] = None            # Auth token (JWT)
    repoUrl: Optional[str] = None          # Git repo to clone
    gitToken: Optional[str] = None         # Git auth token (PAT)
    branch: Optional[str] = None           # Git branch to clone (default: repo default)
    task: str                              # The task for the agent
    projectId: Optional[str] = None        # Optional project context
    model_provider: Optional[str] = None   # "google" | "anthropic"
    api_key: Optional[str] = None          # User's own API key (optional)


class InitSessionResponse(BaseModel):
    status: str
    sessionId: str
    message: str


class SessionStatus(BaseModel):
    sessionId: str
    userId: str
    task: str
    isAlive: bool
    createdAt: str
    totalEvents: int


# ═══════════════════════════════════════════════════════════
#  REST Endpoints
# ═══════════════════════════════════════════════════════════


@app.get("/")
def health_check():
    """Health check with system status."""
    return {
        "service": "Lucid AI Engine",
        "version": "1.0.0",
        "status": "healthy",
        "openhands_available": OPENHANDS_AVAILABLE,
        "agent_server_running": (
            _agent_server.process is not None
            and _agent_server.process.poll() is None
        ),
        "active_sessions": len(active_sessions),
        "llm_model": MODEL_CONFIGS.get(DEFAULT_PROVIDER, {}).get("model", "unknown"),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sessions")
async def list_sessions():
    """List all active sessions (for admin/debug)."""
    return {
        "sessions": [
            {
                "sessionId": s.session_id,
                "userId": s.user_id,
                "task": s.task[:80],
                "isAlive": s.is_alive,
                "createdAt": s.created_at.isoformat(),
            }
            for s in active_sessions.values()
        ]
    }


@app.post("/api/session/init", response_model=InitSessionResponse)
async def init_session(payload: InitSessionRequest):
    """
    Initialize an agent session (called by the Next.js frontend).
    Spin up a sandboxed workspace, create the Conversation,
    and return the session ID for WebSocket connection.
    """
    if not OPENHANDS_AVAILABLE:
        # Return mock session in dev mode
        session_id = str(uuid.uuid4())
        session = AgentSession(
            session_id=session_id,
            user_id="mock_user",
            task=payload.task,
            repo_url=payload.repoUrl,
        )
        active_sessions[session_id] = session
        return InitSessionResponse(
            status="mock",
            sessionId=session_id,
            message=(
                "Mock session created — OpenHands SDK not installed. "
                "Install openhands-sdk to enable real agent execution."
            ),
        )

    session_id = str(uuid.uuid4())

    try:
        # ── 1. Configure LLM (provider-aware) ────────────
        provider = (payload.model_provider or DEFAULT_PROVIDER).lower()
        llm = _resolve_llm(provider, payload.api_key)

        # ── 2. Create Agent (CodeActAgent with default tools) ──
        agent = get_default_agent(llm=llm, cli_mode=True)

        # ── 3. Create Workspace ───────────────────────────
        # If agent server is running → RemoteWorkspace (Docker sandbox)
        # Otherwise → LocalWorkspace (in-process, for dev)
        agent_server_alive = (
            _agent_server.process is not None
            and _agent_server.process.poll() is None
        )

        if agent_server_alive:
            # Production: Docker-sandboxed via agent-server
            workspace = Workspace(host=_agent_server.base_url)
            logger.info(
                f"🐳 Using RemoteWorkspace via Agent Server at "
                f"{_agent_server.base_url}"
            )

            # Clone repo into sandbox if provided
            if payload.repoUrl:
                clone_url = payload.repoUrl
                if payload.gitToken:
                    if "github.com" in clone_url:
                        clone_url = clone_url.replace(
                            "https://",
                            f"https://x-access-token:{payload.gitToken}@",
                        )
                    elif "gitlab" in clone_url:
                        clone_url = clone_url.replace(
                            "https://",
                            f"https://oauth2:{payload.gitToken}@",
                        )

                # Build clone command with optional branch
                branch_flag = f" -b {payload.branch}" if payload.branch else ""
                clone_cmd = f"git clone --depth 1{branch_flag} {clone_url} {WORKSPACE_MOUNT_PATH}/repo"

                result = workspace.execute_command(clone_cmd)
                if result.exit_code != 0:
                    logger.warning(
                        f"⚠️  Git clone failed: {result.stdout}"
                    )
                else:
                    branch_info = f" on branch '{payload.branch}'" if payload.branch else ""
                    logger.info(f"✅ Cloned repository '{payload.repoUrl}'{branch_info}")
        else:
            # Dev mode: local filesystem workspace
            workspace_dir = f"/tmp/lucid_workspace/{session_id}"
            os.makedirs(workspace_dir, exist_ok=True)
            workspace = workspace_dir
            logger.info(f"📁 Using LocalWorkspace at {workspace_dir}")

        # ── 4. Create Conversation ────────────────────────
        session = AgentSession(
            session_id=session_id,
            user_id=payload.projectId or "default_user",
            task=payload.task,
            repo_url=payload.repoUrl,
        )
        session.llm = llm
        session.agent = agent
        session.workspace = workspace

        # Define the event callback — pushes events into the buffer
        def on_event(event):
            """
            Called by the SDK for every event (actions, observations,
            state changes). We push them into an asyncio queue so the
            WebSocket handler can stream them to the frontend.
            """
            try:
                event_data = _format_sdk_event(event)
                if event_data:
                    # Use call_soon_threadsafe for thread-safe queue put
                    try:
                        session.event_buffer.put_nowait(event_data)
                    except asyncio.QueueFull:
                        pass  # Drop oldest if buffer full
            except Exception as e:
                logger.error(f"Event callback error: {e}")

        conversation = Conversation(
            agent=agent,
            workspace=workspace,
            callbacks=[on_event],
        )

        session.conversation = conversation

        # ── 5. Store session ──────────────────────────────
        async with _session_lock:
            active_sessions[session_id] = session

        logger.info(
            f"✅ Session {session_id} created — "
            f"task: {payload.task[:60]}..."
        )

        return InitSessionResponse(
            status="ready",
            sessionId=session_id,
            message="Agent session initialized. Connect via WebSocket to start.",
        )

    except ValueError as e:
        # Catch explicit validation errors (e.g. missing API key)
        logger.error(f"❌ Session init validation error: {e}")
        # Return HTTP 400 with the specific error message
        # But per user request, we return a JSON response matching their format
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "status": "error",
                "message": str(e)
            }
        )
    except Exception as e:
        logger.error(f"❌ Session init failed: {e}", exc_info=True)
        # Catch generic errors (including potential Auth errors from SDK)
        error_msg = str(e)
        if "401" in error_msg or "invalid_api_key" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "status": "error",
                    "message": "Invalid API Key"
                }
            )
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "status": "error",
                "message": f"Failed to initialize session: {error_msg}"
            }
        )


@app.post("/api/session/{session_id}/stop")
async def stop_session(session_id: str):
    """Stop and destroy an agent session."""
    if session_id not in active_sessions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found.",
        )

    await _destroy_session(session_id)

    return {
        "status": "stopped",
        "sessionId": session_id,
        "message": "Session stopped and resources cleaned up.",
    }


# ═══════════════════════════════════════════════════════════
#  File Management Endpoints
# ═══════════════════════════════════════════════════════════


@app.get("/api/files/read")
async def read_file(session_id: str, path: str):
    """
    Read a file from the agent's workspace.

    Query Params:
      - session_id: The active agent session ID
      - path: Absolute path to the file inside the workspace

    Returns: { "content": "..." }
    """
    session = active_sessions.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found.",
        )

    # Sanitize path — prevent traversal attacks
    if ".." in path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal not allowed.",
        )

    try:
        workspace = session.workspace

        if isinstance(workspace, str):
            # Local workspace — read from filesystem
            full_path = os.path.join(workspace, path.lstrip("/"))
            if not os.path.isfile(full_path):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"File not found: {path}",
                )
            with open(full_path, "r", errors="replace") as f:
                content = f.read()
        else:
            # Remote workspace (Docker sandbox)
            safe_path = path.replace('"', '\\"')
            result = await asyncio.to_thread(
                workspace.execute_command,
                f'cat "{safe_path}"',
            )
            if result.exit_code != 0:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"File not found or unreadable: {path}",
                )
            content = result.stdout if hasattr(result, 'stdout') else str(result)

        return {"content": content}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ read_file error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {str(e)}",
        )


@app.get("/api/files/list")
async def list_files_endpoint(session_id: str):
    """
    List all files in the agent's workspace.

    Query Params:
      - session_id: The active agent session ID

    Returns: { "tree": [ { name, type, path, children? }, ... ] }
    """
    session = active_sessions.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found.",
        )

    try:
        tree = await _list_files_in_workspace(session)
        return {"tree": tree}
    except Exception as e:
        logger.error(f"❌ list_files error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list files: {str(e)}",
        )


# ═══════════════════════════════════════════════════════════
#  WebSocket /ws
# ═══════════════════════════════════════════════════════════


@app.websocket("/ws")
async def websocket_agent(websocket: WebSocket):
    """
    Real-time agent communication channel.

    Protocol:
    1. Client connects and sends initial config:
       { "token": "...", "repoUrl": "...", "task": "..." }

    2. Server initializes the agent session and starts the
       CodeActAgent loop.

    3. For every event (commands, file edits, agent thoughts),
       server streams back:
       { "type": "agent_event", "event": "...", "content": "..." }

    4. Client can send follow-up messages:
       { "type": "message", "content": "Now do X" }

    5. On disconnect, the sandbox container is cleaned up.
    """

    await websocket.accept()
    logger.info("🔌 WebSocket connection accepted")

    session: Optional[AgentSession] = None
    streaming_task: Optional[asyncio.Task] = None

    try:
        # ── Step 1: Receive initial config ────────────────
        raw = await asyncio.wait_for(
            websocket.receive_json(), timeout=30.0
        )

        token = raw.get("token", "")
        repo_url = raw.get("repoUrl", "")
        branch = raw.get("branch", "")  # specific branch to clone
        task = raw.get("task", "")
        project_id = raw.get("projectId", "")
        model_provider = raw.get("modelProvider", raw.get("model_provider", DEFAULT_PROVIDER))
        user_api_key = raw.get("apiKey", raw.get("api_key", ""))

        if not task:
            await websocket.send_json({
                "type": "error",
                "message": "Missing required field: 'task'",
            })
            await websocket.close(code=4001, reason="Missing task")
            return

        await websocket.send_json({
            "type": "status",
            "status": "initializing",
            "message": "Setting up agent workspace...",
        })

        # ── Step 2: Initialize session ────────────────────
        if not OPENHANDS_AVAILABLE:
            # ── Mock mode ─────────────────────────────────
            session_id = str(uuid.uuid4())
            session = AgentSession(
                session_id=session_id,
                user_id="ws_user",
                task=task,
                repo_url=repo_url,
            )
            active_sessions[session_id] = session

            await websocket.send_json({
                "type": "status",
                "status": "mock_mode",
                "sessionId": session_id,
                "message": (
                    "Running in MOCK mode — OpenHands SDK not installed. "
                    "Install openhands-sdk, openhands-tools, openhands-workspace "
                    "to enable real agent execution."
                ),
            })

            # Mock agent loop
            await _mock_agent_loop(websocket, session)
            return

        # ── Initialize LLM (provider-aware) ───────────────
        provider = (model_provider or DEFAULT_PROVIDER).lower()
        try:
            llm = _resolve_llm(provider, user_api_key)
        except ValueError as e:
            await websocket.send_json({
                "type": "error",
                "message": str(e),
            })
            await websocket.close(code=4002)
            return

        # ── Create Agent ──────────────────────────────────
        agent = get_default_agent(llm=llm, cli_mode=True)

        # ── Create Workspace ──────────────────────────────
        agent_server_alive = (
            _agent_server.process is not None
            and _agent_server.process.poll() is None
        )

        if agent_server_alive:
            workspace = Workspace(host=_agent_server.base_url)
            logger.info("🐳 WebSocket session using RemoteWorkspace")

            # Clone repo if provided
            if repo_url:
                branch_label = f" (branch: {branch})" if branch else ""
                await websocket.send_json({
                    "type": "agent_event",
                    "event": "system",
                    "content": f"Cloning repository: {repo_url}{branch_label}...",
                })

                clone_url = repo_url
                if token and "github.com" in repo_url:
                    clone_url = repo_url.replace(
                        "https://",
                        f"https://x-access-token:{token}@",
                    )
                elif token and "gitlab" in repo_url:
                    clone_url = repo_url.replace(
                        "https://",
                        f"https://oauth2:{token}@",
                    )

                # Build clone command with optional branch
                branch_flag = f" -b {branch}" if branch else ""
                clone_cmd = f"git clone --depth 1{branch_flag} {clone_url} {WORKSPACE_MOUNT_PATH}/repo"

                result = await asyncio.to_thread(
                    workspace.execute_command,
                    clone_cmd,
                )

                if result.exit_code == 0:
                    branch_info = f" on branch '{branch}'" if branch else ""
                    repo_name = repo_url.rstrip('/').split('/')[-1].replace('.git', '')
                    await websocket.send_json({
                        "type": "agent_event",
                        "event": "system",
                        "content": f"✅ Cloned repository '{repo_name}'{branch_info}.",
                    })
                else:
                    await websocket.send_json({
                        "type": "agent_event",
                        "event": "warning",
                        "content": f"⚠️ Clone failed: {result.stdout}",
                    })
        else:
            workspace_dir = f"/tmp/lucid_workspace/{uuid.uuid4()}"
            os.makedirs(workspace_dir, exist_ok=True)
            workspace = workspace_dir
            logger.info(f"📁 WebSocket session using LocalWorkspace: {workspace_dir}")

        # ── Create Session ────────────────────────────────
        session_id = str(uuid.uuid4())
        session = AgentSession(
            session_id=session_id,
            user_id=project_id or "ws_user",
            task=task,
            repo_url=repo_url,
        )
        session.llm = llm
        session.agent = agent
        session.workspace = workspace

        # Event callback → queue → WebSocket
        def on_event(event):
            event_data = _format_sdk_event(event)
            if event_data:
                try:
                    session.event_buffer.put_nowait(event_data)
                except asyncio.QueueFull:
                    pass

        conversation = Conversation(
            agent=agent,
            workspace=workspace,
            callbacks=[on_event],
        )
        session.conversation = conversation

        async with _session_lock:
            active_sessions[session_id] = session

        await websocket.send_json({
            "type": "status",
            "status": "ready",
            "sessionId": session_id,
            "message": "Agent session ready. Starting task...",
        })

        # ── Step 3: Start the agent loop ──────────────────

        # Start event streaming task (reads from queue → sends to WS)
        streaming_task = asyncio.create_task(
            _stream_events_to_ws(websocket, session)
        )

        # Send initial task to the agent
        await websocket.send_json({
            "type": "agent_event",
            "event": "task_start",
            "content": f"🤖 Agent starting task: {task}",
        })

        conversation.send_message(task)

        # Run the agent (blocking until completion/max iterations)
        await asyncio.to_thread(conversation.run)

        await websocket.send_json({
            "type": "status",
            "status": "completed",
            "message": "Agent task completed.",
        })

        # ── Step 4: Listen for follow-up messages ─────────
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "message")
            content = data.get("content", "")

            if not content:
                await websocket.send_json({
                    "type": "error",
                    "message": "Empty content",
                })
                continue

            if msg_type == "stop":
                await websocket.send_json({
                    "type": "status",
                    "status": "stopping",
                    "message": "Stopping agent...",
                })
                break

            # Send follow-up message to agent
            logger.info(
                f"📩 [{session_id}] Follow-up: {content[:80]}..."
            )

            await websocket.send_json({
                "type": "agent_event",
                "event": "task_start",
                "content": f"🤖 Processing: {content[:80]}...",
            })

            conversation.send_message(content)
            await asyncio.to_thread(conversation.run)

            await websocket.send_json({
                "type": "status",
                "status": "completed",
                "message": "Follow-up task completed.",
            })

    except WebSocketDisconnect:
        logger.info(
            f"🔌 WebSocket disconnected"
            f"{f' — session {session.session_id}' if session else ''}"
        )
    except asyncio.TimeoutError:
        logger.warning("⏰ WebSocket initial config timeout")
        try:
            await websocket.send_json({
                "type": "error",
                "message": "Timeout waiting for initial configuration.",
            })
        except Exception:
            pass
    except Exception as e:
        logger.error(f"❌ WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Internal error: {str(e)}",
            })
        except Exception:
            pass
    finally:
        # ── Cleanup ───────────────────────────────────────
        if streaming_task:
            streaming_task.cancel()
            try:
                await streaming_task
            except asyncio.CancelledError:
                pass

        if session:
            await _destroy_session(session.session_id)

        logger.info("🧹 WebSocket session cleaned up")


# ═══════════════════════════════════════════════════════════
#  Internal Helpers
# ═══════════════════════════════════════════════════════════


def _resolve_llm(
    provider: str,
    user_api_key: Optional[str] = None,
) -> "LLM":
    """
    Build an LLM instance for the given provider.

    Resolution order for the API key:
      1. User-supplied key (from frontend)
      2. Provider-specific env var (GOOGLE_API_KEY / ANTHROPIC_API_KEY)
      3. Generic LLM_API_KEY env var (legacy fallback)

    For Google Gemini, safety_settings are set to BLOCK_NONE
    so the coding agent isn't refused when generating code that
    looks like shell commands, network requests, etc.
    """
    if provider not in MODEL_CONFIGS:
        raise ValueError(
            f"Unsupported model provider: '{provider}'. "
            f"Choose from: {', '.join(MODEL_CONFIGS.keys())}"
        )

    config = MODEL_CONFIGS[provider]
    model_name = config["model"]

    # Resolve API key with fallback chain
    resolved_key = (
        user_api_key
        or os.getenv(config["env_key"], "")
        or LLM_API_KEY
    )

    if not resolved_key:
        raise ValueError(
            f"No API key found for {config['label']}. "
            f"Set {config['env_key']} environment variable or "
            f"provide a key in the request."
        )

    # Build kwargs for the LLM constructor
    llm_kwargs = {
        "model": model_name,
        "api_key": SecretStr(resolved_key),
    }

    if LLM_BASE_URL:
        llm_kwargs["base_url"] = LLM_BASE_URL

    # Gemini-specific: disable safety filters for coding agents
    if provider == "google":
        llm_kwargs["safety_settings"] = GEMINI_SAFETY_SETTINGS
        logger.info(
            f"🔮 Using Gemini ({model_name}) with safety_settings=BLOCK_NONE"
        )
    else:
        logger.info(f"🧠 Using Anthropic ({model_name})")

    return LLM(**llm_kwargs)

async def _stream_events_to_ws(
    websocket: WebSocket,
    session: AgentSession,
):
    """
    Background task: reads events from the session's buffer
    queue and sends them to the WebSocket client in real-time.

    Auto-triggers a file_tree refresh when file-changing events
    are detected (create, write, rm, git clone, etc.).
    """
    try:
        while session.is_alive:
            try:
                event_data = await asyncio.wait_for(
                    session.event_buffer.get(), timeout=1.0
                )
                await websocket.send_json(event_data)

                # ── Auto-sync: refresh file tree on file-changing events ──
                if _should_refresh_file_tree(event_data):
                    try:
                        tree = await _list_files_in_workspace(session)
                        await websocket.send_json({
                            "type": "file_tree",
                            "tree": tree,
                            "timestamp": _now_iso(),
                        })
                    except Exception as tree_err:
                        logger.warning(
                            f"⚠️  File tree refresh failed: {tree_err}"
                        )

            except asyncio.TimeoutError:
                continue  # No events yet, keep polling
            except Exception:
                break  # WebSocket closed
    except asyncio.CancelledError:
        pass


def _format_sdk_event(event) -> Optional[dict]:
    """
    Convert an OpenHands SDK event into a JSON-serializable dict
    for WebSocket transmission.

    Events in the V1 SDK are typed objects with attributes like
    `type(event).__name__`, and fields vary by event type.
    """
    event_type = type(event).__name__
    content = ""

    # Extract content based on event type
    if hasattr(event, "content"):
        content = str(event.content)
    elif hasattr(event, "message"):
        content = str(event.message)
    elif hasattr(event, "text"):
        content = str(event.text)

    # Classify the event for the frontend
    if isinstance(event, ConversationStateUpdateEvent):
        return {
            "type": "agent_event",
            "event": "state_update",
            "content": content or str(event),
            "timestamp": _now_iso(),
        }

    # Map common event type names
    event_category = "observation"
    if "Action" in event_type:
        event_category = "action"
    elif "Error" in event_type:
        event_category = "error"
    elif "State" in event_type or "Update" in event_type:
        event_category = "state"

    # Extract additional fields
    payload: dict = {
        "type": "agent_event",
        "event": event_category,
        "eventType": event_type,
        "content": content[:2000],  # Truncate for WS
        "timestamp": _now_iso(),
    }

    # Add command-specific fields
    if hasattr(event, "command"):
        payload["command"] = str(event.command)
    if hasattr(event, "exit_code"):
        payload["exitCode"] = event.exit_code
    if hasattr(event, "path"):
        payload["path"] = str(event.path)
    if hasattr(event, "thought"):
        thought = event.thought
        if thought:
            payload["thought"] = str(thought)[:1000]

    return payload


async def _mock_agent_loop(
    websocket: WebSocket,
    session: AgentSession,
):
    """
    Mock agent loop for development when OpenHands is not installed.
    Simulates the agent processing a task with staged responses.
    """
    mock_steps = [
        {
            "type": "agent_event",
            "event": "action",
            "eventType": "ThinkAction",
            "content": f"Analyzing task: \"{session.task}\"",
            "thought": "Let me break this down into steps...",
        },
        {
            "type": "agent_event",
            "event": "action",
            "eventType": "CmdRunAction",
            "content": "mkdir -p /workspace && cd /workspace",
            "command": "mkdir -p /workspace && cd /workspace",
        },
        {
            "type": "agent_event",
            "event": "observation",
            "eventType": "CmdOutputObservation",
            "content": "Directory created successfully.",
            "exitCode": 0,
        },
        {
            "type": "agent_event",
            "event": "action",
            "eventType": "FileWriteAction",
            "content": 'print("Hello, World!")',
            "path": "/workspace/hello.py",
        },
        {
            "type": "agent_event",
            "event": "observation",
            "eventType": "FileWriteObservation",
            "content": "File written: /workspace/hello.py",
            "path": "/workspace/hello.py",
        },
        {
            "type": "agent_event",
            "event": "action",
            "eventType": "CmdRunAction",
            "content": "python /workspace/hello.py",
            "command": "python /workspace/hello.py",
        },
        {
            "type": "agent_event",
            "event": "observation",
            "eventType": "CmdOutputObservation",
            "content": "Hello, World!",
            "exitCode": 0,
        },
        {
            "type": "status",
            "status": "completed",
            "message": (
                "✅ [MOCK] Task completed. This is a simulated response. "
                "Install the OpenHands SDK packages to enable real "
                "Docker-sandboxed agent execution."
            ),
        },
    ]

    for step in mock_steps:
        step["timestamp"] = _now_iso()
        await websocket.send_json(step)
        await asyncio.sleep(1.5)

    # Listen for follow-up messages
    try:
        while True:
            data = await websocket.receive_json()
            content = data.get("content", "")
            if content:
                await websocket.send_json({
                    "type": "agent_event",
                    "event": "observation",
                    "eventType": "MockResponse",
                    "content": (
                        f"[MOCK] Received: \"{content}\"\n"
                        "The agent would process this in production mode."
                    ),
                    "timestamp": _now_iso(),
                })
    except (WebSocketDisconnect, Exception):
        pass


async def _destroy_session(session_id: str):
    """Stop and clean up an agent session."""
    async with _session_lock:
        session = active_sessions.pop(session_id, None)

    if not session:
        return

    session.is_alive = False
    logger.info(f"🗑️  Destroying session {session_id}")

    # Close the conversation (cleans up agent-server resources)
    if session.conversation:
        try:
            if hasattr(session.conversation, "close"):
                await asyncio.to_thread(session.conversation.close)
            logger.info(f"✅ Conversation closed for session {session_id}")
        except Exception as e:
            logger.error(
                f"⚠️  Error closing conversation: {e}"
            )

    # Clean up local workspace directory if applicable
    if isinstance(session.workspace, str) and session.workspace.startswith("/tmp/"):
        try:
            import shutil
            shutil.rmtree(session.workspace, ignore_errors=True)
        except Exception:
            pass


def _now_iso() -> str:
    """Return current UTC time as ISO string."""
    return datetime.now(timezone.utc).isoformat()


# ── File-change detection patterns ────────────────────────
# Commands / event types that indicate the workspace file tree
# may have changed and should be re-sent to the frontend.
_FILE_CHANGE_COMMANDS = re.compile(
    r"\b(touch|mkdir|rm|rmdir|mv|cp|git\s+clone|git\s+checkout|"
    r"git\s+pull|wget|curl\s+-[oO]|unzip|tar|npm\s+init|pip\s+install|"
    r"npx|create-react-app|tee|dd|install)\b",
    re.IGNORECASE,
)

_FILE_CHANGE_EVENT_TYPES = {
    "FileWriteAction", "FileWriteObservation",
    "FileEditAction", "FileEditObservation",
    "FileCreateAction", "FileCreateObservation",
    "FileDeleteAction", "FileDeleteObservation",
    "CmdRunAction",  # handled via command regex below
}


def _should_refresh_file_tree(event_data: dict) -> bool:
    """
    Determine if an agent event indicates the workspace file tree
    may have changed. Used to auto-send file_tree updates.
    """
    event_type = event_data.get("eventType", "")

    # File write / edit / create / delete events always trigger refresh
    if event_type in _FILE_CHANGE_EVENT_TYPES and event_type != "CmdRunAction":
        return True

    # For command events, check the actual command text
    command = event_data.get("command", "") or event_data.get("content", "")
    if command and _FILE_CHANGE_COMMANDS.search(command):
        return True

    return False


async def _list_files_in_workspace(
    session: AgentSession,
    root: str = WORKSPACE_MOUNT_PATH,
) -> List[dict]:
    """
    List all files in the agent's workspace as a recursive tree.

    For remote workspaces (Docker): runs `find` inside the container.
    For local workspaces: uses os.walk on the host filesystem.

    Returns:
        [
            { "name": "src", "type": "folder", "path": "/workspace/src", "children": [...] },
            { "name": "main.py", "type": "file", "path": "/workspace/main.py" },
        ]
    """
    workspace = session.workspace

    if isinstance(workspace, str):
        # ── Local workspace ──────────────────────────────
        return _build_local_file_tree(workspace)
    else:
        # ── Remote workspace (Docker sandbox) ────────────
        return await _build_remote_file_tree(workspace, root)


def _build_local_file_tree(root_dir: str) -> List[dict]:
    """
    Build a file tree from a local directory using os.walk.
    Excludes common noise directories (.git, node_modules, __pycache__, .next).
    """
    EXCLUDE_DIRS = {
        ".git", "node_modules", "__pycache__", ".next",
        ".venv", "venv", ".mypy_cache", ".pytest_cache",
        "dist", "build", ".tox", ".eggs",
    }

    def walk_dir(dir_path: str) -> List[dict]:
        entries = []
        try:
            items = sorted(os.listdir(dir_path))
        except PermissionError:
            return entries

        for item in items:
            full_path = os.path.join(dir_path, item)
            rel_path = os.path.relpath(full_path, root_dir)

            if os.path.isdir(full_path):
                if item in EXCLUDE_DIRS or item.startswith("."):
                    continue
                entries.append({
                    "name": item,
                    "type": "folder",
                    "path": "/" + rel_path,
                    "children": walk_dir(full_path),
                })
            else:
                entries.append({
                    "name": item,
                    "type": "file",
                    "path": "/" + rel_path,
                })

        return entries

    return walk_dir(root_dir)


async def _build_remote_file_tree(
    workspace,
    root: str = WORKSPACE_MOUNT_PATH,
) -> List[dict]:
    """
    Build a file tree by running `find` inside the Docker container.
    Returns a nested tree structure from the flat `find` output.
    """
    EXCLUDE_PATTERNS = (
        "-name .git -prune -o "
        "-name node_modules -prune -o "
        "-name __pycache__ -prune -o "
        "-name .next -prune -o "
        "-name .venv -prune -o "
        "-name venv -prune -o "
    )

    cmd = (
        f'find {root} {EXCLUDE_PATTERNS}'
        f'-print 2>/dev/null | sort'
    )

    result = await asyncio.to_thread(workspace.execute_command, cmd)

    raw_output = result.stdout if hasattr(result, 'stdout') else str(result)
    lines = [l.strip() for l in raw_output.strip().split("\n") if l.strip()]

    # Filter out the root itself and any empty lines
    lines = [l for l in lines if l and l != root]

    if not lines:
        return []

    # Build tree from flat paths
    tree_root: Dict[str, Any] = {"children": {}}

    for line in lines:
        # Make path relative to root
        if line.startswith(root):
            rel = line[len(root):].lstrip("/")
        else:
            rel = line.lstrip("/")

        if not rel:
            continue

        parts = rel.split("/")
        current = tree_root

        for i, part in enumerate(parts):
            if part not in current["children"]:
                is_last = (i == len(parts) - 1)
                current["children"][part] = {
                    "name": part,
                    "children": {},
                }
            current = current["children"][part]

    # Now determine folder vs file by checking for children,
    # and then run `find -type d` to get definitive folder list
    dir_cmd = f'find {root} {EXCLUDE_PATTERNS}-type d -print 2>/dev/null'
    dir_result = await asyncio.to_thread(workspace.execute_command, dir_cmd)
    dir_output = dir_result.stdout if hasattr(dir_result, 'stdout') else str(dir_result)
    dir_set = set()
    for d in dir_output.strip().split("\n"):
        d = d.strip()
        if d.startswith(root):
            dir_set.add(d[len(root):].lstrip("/"))
        elif d:
            dir_set.add(d.lstrip("/"))

    def convert(node: dict, parent_path: str = "") -> List[dict]:
        result_list = []
        for name, child in sorted(node["children"].items()):
            rel_path = f"{parent_path}/{name}" if parent_path else name
            full_path = f"{root}/{rel_path}"

            if child["children"] or rel_path in dir_set:
                result_list.append({
                    "name": name,
                    "type": "folder",
                    "path": full_path,
                    "children": convert(child, rel_path),
                })
            else:
                result_list.append({
                    "name": name,
                    "type": "file",
                    "path": full_path,
                })
        return result_list

    return convert(tree_root)


# ═══════════════════════════════════════════════════════════
#  Entry Point
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=True,
        log_level="info",
    )

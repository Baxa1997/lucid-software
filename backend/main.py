# ─────────────────────────────────────────────────────────
#  u-code — AI Agent Microservice
#  FastAPI + OpenHands SDK · Multi-Tenant Docker Isolation
# ─────────────────────────────────────────────────────────

import os
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    Header,
    HTTPException,
    status,
)
from pydantic import BaseModel, Field

# ── OpenHands SDK Imports ───────────────────────────────────
# These are imported conditionally so the app can still start
# if OpenHands is not installed (useful for dev/testing).
try:
    from openhands.core.config import (
        AppConfig,
        SandboxConfig,
        LLMConfig,
    )
    from openhands.runtime.docker.docker_runtime import DockerRuntime
    from openhands.controller.agent import Agent
    from openhands.controller import AgentController
    from openhands.events.action import (
        CmdRunAction,
        FileWriteAction,
        MessageAction,
    )
    from openhands.events.observation import (
        CmdOutputObservation,
        FileWriteObservation,
        AgentStateChangedObservation,
        ErrorObservation,
    )
    from openhands.events.stream import EventStream

    OPENHANDS_AVAILABLE = True
except ImportError:
    OPENHANDS_AVAILABLE = False

# ═══════════════════════════════════════════════════════════
#  Logging
# ═══════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-7s │ %(name)s │ %(message)s",
)
logger = logging.getLogger("ucode.agent")

# ═══════════════════════════════════════════════════════════
#  Configuration
# ═══════════════════════════════════════════════════════════

LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", None)
MAX_ITERATIONS = int(os.getenv("MAX_ITERATIONS", "50"))
CONTAINER_IMAGE = os.getenv("SANDBOX_IMAGE", "python:3.12-bookworm")

# ═══════════════════════════════════════════════════════════
#  Global Session Store
# ═══════════════════════════════════════════════════════════

class AgentSessionInfo:
    """Holds runtime + agent state for a single user session."""

    def __init__(
        self,
        session_id: str,
        user_id: str,
        org_id: str,
        runtime: Optional[object] = None,
        controller: Optional[object] = None,
        event_stream: Optional[object] = None,
    ):
        self.session_id = session_id
        self.user_id = user_id
        self.org_id = org_id
        self.runtime = runtime
        self.controller = controller
        self.event_stream = event_stream
        self.created_at = datetime.now(timezone.utc)
        self.is_alive = True
        self.container_name = f"sandbox_{user_id}"


# Global dict: user_id → AgentSessionInfo
active_runtimes: dict[str, AgentSessionInfo] = {}

# Lock to prevent race conditions during session creation
_session_lock = asyncio.Lock()


# ═══════════════════════════════════════════════════════════
#  Lifecycle — Cleanup on Shutdown
# ═══════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Cleanup all Docker containers when the server shuts down."""
    logger.info("🚀 u-code Agent Microservice starting...")
    yield
    logger.info("🛑 Shutting down — cleaning up all sandboxes...")
    for user_id in list(active_runtimes.keys()):
        await _destroy_session(user_id)
    logger.info("✅ All sandboxes cleaned up.")


# ═══════════════════════════════════════════════════════════
#  FastAPI App
# ═══════════════════════════════════════════════════════════

app = FastAPI(
    title="u-code Agent Service",
    description="Multi-tenant AI agent microservice wrapping the OpenHands SDK",
    version="0.1.0",
    lifespan=lifespan,
)


# ═══════════════════════════════════════════════════════════
#  Request / Response Models
# ═══════════════════════════════════════════════════════════

class StartSessionRequest(BaseModel):
    project_id: str
    project_name: str = ""
    repo_url: Optional[str] = None
    provider: Optional[str] = None  # "github" | "gitlab"
    branch: str = "main"
    task: str
    sandbox_mode: bool = True
    git_token: Optional[str] = None  # decrypted by the Gatekeeper


class StartSessionResponse(BaseModel):
    session_id: str
    container_name: str
    container_url: Optional[str] = None
    status: str = "active"
    message: str = "Session started successfully"


class SessionStatusResponse(BaseModel):
    session_id: str
    user_id: str
    org_id: str
    container_name: str
    is_alive: bool
    created_at: str


class StopSessionResponse(BaseModel):
    session_id: str
    status: str = "stopped"
    message: str = "Session stopped and container removed"


# ═══════════════════════════════════════════════════════════
#  Health Check
# ═══════════════════════════════════════════════════════════

@app.get("/")
def health_check():
    return {
        "service": "u-code Agent Microservice",
        "status": "healthy",
        "openhands_available": OPENHANDS_AVAILABLE,
        "active_sessions": len(active_runtimes),
    }


# ═══════════════════════════════════════════════════════════
#  POST /start-session
# ═══════════════════════════════════════════════════════════

@app.post("/start-session", response_model=StartSessionResponse)
async def start_session(
    body: StartSessionRequest,
    x_user_id: str = Header(..., alias="X-User-ID"),
    x_org_id: str = Header(..., alias="X-Org-ID"),
):
    """
    Start an AI agent session for a user.

    - If the user already has an active session, return it.
    - Otherwise, spin up a new Docker sandbox, initialize
      the CodeActAgent, and store everything in memory.
    """

    async with _session_lock:
        # ── Check for existing session ──────────────────────
        if x_user_id in active_runtimes:
            existing = active_runtimes[x_user_id]
            if existing.is_alive:
                logger.info(
                    f"♻️  Returning existing session for user={x_user_id} "
                    f"session={existing.session_id}"
                )
                return StartSessionResponse(
                    session_id=existing.session_id,
                    container_name=existing.container_name,
                    status="active",
                    message="Existing active session returned",
                )
            else:
                # Dead session — clean up and create new
                await _destroy_session(x_user_id)

        # ── Create new session ──────────────────────────────
        session_id = str(uuid.uuid4())
        container_name = f"sandbox_{x_user_id}"

        logger.info(
            f"🆕 Creating session for user={x_user_id} org={x_org_id} "
            f"project={body.project_name} session={session_id}"
        )

        session_info = AgentSessionInfo(
            session_id=session_id,
            user_id=x_user_id,
            org_id=x_org_id,
        )

        container_url = None

        if OPENHANDS_AVAILABLE:
            try:
                runtime, controller, event_stream = await _initialize_openhands(
                    session_id=session_id,
                    container_name=container_name,
                    task=body.task,
                    repo_url=body.repo_url,
                    branch=body.branch,
                    git_token=body.git_token,
                    sandbox_mode=body.sandbox_mode,
                )

                session_info.runtime = runtime
                session_info.controller = controller
                session_info.event_stream = event_stream

                logger.info(
                    f"✅ OpenHands runtime ready — container={container_name}"
                )

            except Exception as e:
                logger.error(f"❌ Failed to initialize OpenHands: {e}", exc_info=True)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to start sandbox: {str(e)}",
                )
        else:
            # ── Mock mode (OpenHands not installed) ─────────
            logger.warning(
                "⚠️  OpenHands not available — running in MOCK mode"
            )

        active_runtimes[x_user_id] = session_info

        return StartSessionResponse(
            session_id=session_id,
            container_name=container_name,
            container_url=container_url,
            status="active",
            message="Session started successfully",
        )


# ═══════════════════════════════════════════════════════════
#  POST /stop-session/{agent_session_id}
# ═══════════════════════════════════════════════════════════

@app.post("/stop-session/{agent_session_id}", response_model=StopSessionResponse)
async def stop_session(
    agent_session_id: str,
    x_user_id: str = Header(..., alias="X-User-ID"),
    x_org_id: str = Header(..., alias="X-Org-ID"),
):
    """Stop and destroy a user's sandbox session."""

    # Find session by agent_session_id
    target_user_id = None
    for uid, session in active_runtimes.items():
        if session.session_id == agent_session_id:
            # Verify ownership
            if session.user_id != x_user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not own this session.",
                )
            target_user_id = uid
            break

    if target_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {agent_session_id} not found.",
        )

    await _destroy_session(target_user_id)

    return StopSessionResponse(
        session_id=agent_session_id,
        status="stopped",
        message="Session stopped and container removed",
    )


# ═══════════════════════════════════════════════════════════
#  GET /sessions — List active sessions (admin/debug)
# ═══════════════════════════════════════════════════════════

@app.get("/sessions")
async def list_sessions(
    x_user_id: str = Header(..., alias="X-User-ID"),
    x_org_id: str = Header(..., alias="X-Org-ID"),
):
    """List all active sessions (filtered to the requesting user's org)."""
    return {
        "sessions": [
            SessionStatusResponse(
                session_id=s.session_id,
                user_id=s.user_id,
                org_id=s.org_id,
                container_name=s.container_name,
                is_alive=s.is_alive,
                created_at=s.created_at.isoformat(),
            ).model_dump()
            for s in active_runtimes.values()
            if s.org_id == x_org_id
        ]
    }


# ═══════════════════════════════════════════════════════════
#  WebSocket /ws/{session_id}
# ═══════════════════════════════════════════════════════════

@app.websocket("/ws/{session_id}")
async def websocket_agent(
    websocket: WebSocket,
    session_id: str,
):
    """
    Real-time communication channel between the client and the
    AI agent. The client sends instructions as JSON messages,
    and receives streamed observation events back.

    Query params (injected by the Gatekeeper):
      - userId: the authenticated user's ID
      - orgId:  the user's active organization ID

    Message format (client → server):
      { "type": "message", "content": "Fix the login bug" }
      { "type": "command", "content": "ls -la" }

    Message format (server → client):
      { "type": "observation", "event": "cmd_output", "content": "..." }
      { "type": "agent_state", "state": "running" }
      { "type": "error", "message": "..." }
    """

    # ── 1. Extract identity from query params ─────────────
    user_id = websocket.query_params.get("userId")
    org_id = websocket.query_params.get("orgId")

    if not user_id or not org_id:
        await websocket.close(code=4001, reason="Missing userId or orgId")
        return

    # ── 2. Find the session ───────────────────────────────
    session_info = None
    for s in active_runtimes.values():
        if s.session_id == session_id and s.user_id == user_id:
            session_info = s
            break

    if not session_info:
        await websocket.close(code=4004, reason="Session not found or access denied")
        return

    if not session_info.is_alive:
        await websocket.close(code=4010, reason="Session is no longer active")
        return

    # ── 3. Accept the connection ──────────────────────────
    await websocket.accept()
    logger.info(
        f"🔌 WebSocket connected — user={user_id} session={session_id}"
    )

    await websocket.send_json({
        "type": "connected",
        "session_id": session_id,
        "message": "Connected to agent session",
    })

    # ── 4. Message Loop ───────────────────────────────────
    try:
        # Start a background task to stream observations
        observation_task = asyncio.create_task(
            _stream_observations(websocket, session_info)
        )

        while True:
            # Receive client message
            data = await websocket.receive_json()
            msg_type = data.get("type", "message")
            content = data.get("content", "")

            if not content:
                await websocket.send_json({
                    "type": "error",
                    "message": "Empty content",
                })
                continue

            logger.info(
                f"📩 [{session_id}] Received {msg_type}: {content[:80]}..."
            )

            # ── Dispatch to agent ─────────────────────────
            if OPENHANDS_AVAILABLE and session_info.controller:
                try:
                    if msg_type == "command":
                        action = CmdRunAction(command=content)
                    elif msg_type == "file_write":
                        path = data.get("path", "/tmp/output.txt")
                        action = FileWriteAction(path=path, content=content)
                    else:
                        action = MessageAction(content=content)

                    # Dispatch the action to the event stream
                    session_info.event_stream.add_event(action, "user")

                    await websocket.send_json({
                        "type": "ack",
                        "message": f"Action dispatched: {msg_type}",
                    })

                except Exception as e:
                    logger.error(f"❌ Agent action error: {e}", exc_info=True)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Agent error: {str(e)}",
                    })
            else:
                # ── Mock mode ─────────────────────────────
                await websocket.send_json({
                    "type": "observation",
                    "event": "mock_response",
                    "content": (
                        f"[MOCK] Received your {msg_type}: \"{content}\"\n"
                        "OpenHands is not installed — running in mock mode.\n"
                        "In production, this would execute in a sandboxed container."
                    ),
                })

    except WebSocketDisconnect:
        logger.info(f"🔌 WebSocket disconnected — user={user_id} session={session_id}")
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
        # Cancel the observation streaming task
        if "observation_task" in dir() and observation_task:
            observation_task.cancel()


# ═══════════════════════════════════════════════════════════
#  Internal Helpers
# ═══════════════════════════════════════════════════════════

async def _initialize_openhands(
    session_id: str,
    container_name: str,
    task: str,
    repo_url: Optional[str],
    branch: str,
    git_token: Optional[str],
    sandbox_mode: bool,
):
    """
    Initialize the OpenHands DockerRuntime + CodeActAgent.
    Returns (runtime, controller, event_stream).
    """

    # ── Build config ──────────────────────────────────
    llm_config = LLMConfig(
        model=LLM_MODEL,
        api_key=LLM_API_KEY,
        base_url=LLM_BASE_URL,
    )

    sandbox_config = SandboxConfig(
        container_image=CONTAINER_IMAGE,
        container_name=container_name,
        timeout=300,
        enable_auto_lint=True,
    )

    config = AppConfig(
        llm=llm_config,
        sandbox=sandbox_config,
        max_iterations=MAX_ITERATIONS,
        workspace_base="/workspace",
    )

    # ── Initialize event stream ───────────────────────
    event_stream = EventStream(sid=session_id)

    # ── Create runtime ────────────────────────────────
    runtime = DockerRuntime(
        config=config,
        event_stream=event_stream,
        sid=session_id,
    )

    # Start the sandbox container
    await asyncio.to_thread(runtime.connect)

    # ── Clone repo if provided ────────────────────────
    if repo_url:
        clone_url = repo_url
        if git_token and "github.com" in repo_url:
            # Inject token into HTTPS URL for private repos
            clone_url = repo_url.replace(
                "https://", f"https://x-access-token:{git_token}@"
            )
        elif git_token and "gitlab" in repo_url:
            clone_url = repo_url.replace(
                "https://", f"https://oauth2:{git_token}@"
            )

        clone_cmd = f"git clone --branch {branch} --depth 1 {clone_url} /workspace/repo"
        action = CmdRunAction(command=clone_cmd)
        event_stream.add_event(action, "system")

        logger.info(f"📦 Cloning repo into sandbox: {repo_url} @ {branch}")

    # ── Initialize agent ──────────────────────────────
    agent = Agent.get_cls("CodeActAgent")(llm=llm_config)

    controller = AgentController(
        agent=agent,
        event_stream=event_stream,
        max_iterations=MAX_ITERATIONS,
        sid=session_id,
        initial_state=None,
    )

    # ── Send initial task ─────────────────────────────
    initial_action = MessageAction(content=task)
    event_stream.add_event(initial_action, "user")

    logger.info(f"🤖 Agent initialized with task: {task[:80]}...")

    return runtime, controller, event_stream


async def _stream_observations(
    websocket: WebSocket,
    session_info: AgentSessionInfo,
):
    """
    Background task that polls the event stream for new
    observations and sends them to the client via WebSocket.
    """

    if not OPENHANDS_AVAILABLE or not session_info.event_stream:
        return

    last_event_id = -1

    try:
        while session_info.is_alive:
            await asyncio.sleep(0.3)  # Poll interval

            try:
                events = session_info.event_stream.get_events(
                    start_id=last_event_id + 1
                )
            except Exception:
                continue

            for event in events:
                last_event_id = event.id if hasattr(event, "id") else last_event_id + 1

                # ── Format observation for the client ─────
                payload = _format_event(event)
                if payload:
                    try:
                        await websocket.send_json(payload)
                    except Exception:
                        return  # Connection closed

    except asyncio.CancelledError:
        pass


def _format_event(event) -> Optional[dict]:
    """Convert an OpenHands event into a JSON-serializable dict."""

    if isinstance(event, CmdOutputObservation):
        return {
            "type": "observation",
            "event": "cmd_output",
            "content": event.content,
            "command": getattr(event, "command", ""),
            "exit_code": getattr(event, "exit_code", None),
        }
    elif isinstance(event, FileWriteObservation):
        return {
            "type": "observation",
            "event": "file_write",
            "path": getattr(event, "path", ""),
            "content": event.content[:500],  # truncate for WS
        }
    elif isinstance(event, AgentStateChangedObservation):
        return {
            "type": "agent_state",
            "state": str(getattr(event, "agent_state", "unknown")),
        }
    elif isinstance(event, ErrorObservation):
        return {
            "type": "error",
            "message": event.content,
        }
    elif isinstance(event, MessageAction):
        # Agent's own messages (thinking, planning)
        source = getattr(event, "source", "agent")
        if source == "agent":
            return {
                "type": "observation",
                "event": "agent_message",
                "content": event.content,
            }

    return None


async def _destroy_session(user_id: str):
    """Stop the Docker container and clean up the session."""

    session = active_runtimes.pop(user_id, None)
    if not session:
        return

    session.is_alive = False
    logger.info(
        f"🗑️  Destroying session for user={user_id} "
        f"container={session.container_name}"
    )

    if session.runtime and OPENHANDS_AVAILABLE:
        try:
            await asyncio.to_thread(session.runtime.close)
            logger.info(f"✅ Container {session.container_name} removed")
        except Exception as e:
            logger.error(
                f"⚠️  Failed to destroy container {session.container_name}: {e}"
            )

    if session.controller:
        try:
            session.controller.close()
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════
#  Entry Point
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )

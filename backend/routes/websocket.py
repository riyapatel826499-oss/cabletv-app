from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import List, Optional
import asyncio
import json

from jose import jwt, JWTError
from config import SECRET_KEY, ALGORITHM

router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    def __init__(self):
        # Each entry: {"ws": WebSocket, "operator_id": int|None, "role": str|None}
        self.active_connections: List[dict] = []

    async def connect(self, websocket: WebSocket, operator_id=None, role=None):
        await websocket.accept()
        self.active_connections.append(
            {"ws": websocket, "operator_id": operator_id, "role": role}
        )

    def disconnect(self, websocket: WebSocket):
        self.active_connections = [
            c for c in self.active_connections if c["ws"] is not websocket
        ]

    async def broadcast(self, message: dict):
        data = json.dumps(message)
        # Determine which operator this event belongs to (if any).
        event_oid = None
        if isinstance(message, dict):
            payload = message.get("data")
            if isinstance(payload, dict):
                event_oid = payload.get("operator_id")
        disconnected = []
        for conn in self.active_connections:
            ws = conn["ws"]
            # Master (role 'master' or no operator scope) receives everything.
            # Other sockets only receive events for their own operator.
            is_master = conn.get("role") == "master" or conn.get("operator_id") is None
            if (not is_master) and event_oid is not None and conn.get("operator_id") != event_oid:
                continue
            try:
                await ws.send_text(data)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws)


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    """WebSocket endpoint. Requires a valid JWT; sockets are scoped by operator."""
    # Reject connections without a valid token.
    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        return
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        await websocket.close(code=4001, reason="Invalid token")
        return

    # Tag the socket with its operator scope (oid claim) and role.
    operator_id = payload.get("oid")
    role = payload.get("role")

    await manager.connect(websocket, operator_id=operator_id, role=role)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data) if data else {}
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


async def broadcast_event(event_type: str, data: dict):
    """Call this from other routes to broadcast events."""
    await manager.broadcast({"type": event_type, "data": data})

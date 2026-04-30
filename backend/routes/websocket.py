from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import List, Optional
import asyncio
import json

from jose import jwt, JWTError
from config import SECRET_KEY, ALGORITHM

router = APIRouter(tags=["WebSocket"])


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        data = json.dumps(message)
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(data)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    """WebSocket with optional JWT auth. If token provided, validates it."""
    if token:
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            # Token is valid — connection is authenticated
        except JWTError:
            await websocket.close(code=4001, reason="Invalid token")
            return

    await manager.connect(websocket)
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

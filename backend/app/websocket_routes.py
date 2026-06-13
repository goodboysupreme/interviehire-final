from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.websocket_manager import manager
from app.schemas import OutgoingMessage, ErrorMessage
import json
import asyncio
from app.mock_stream import generate_mock_events

router = APIRouter()

# Global reference to keep the task alive
mock_task = None

@router.on_event("startup")
async def startup_event():
    global mock_task
    # Start the mock stream in the background when the server starts
    mock_task = asyncio.create_task(generate_mock_events())

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Defaulting to global room for now
    room_id = "global"
    await manager.connect(websocket, room_id)
    
    # Send welcome message
    welcome_msg = OutgoingMessage(type="welcome", content="Connected to IntervieHire server").model_dump_json()
    await manager.send_personal_message(welcome_msg, websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg_data = json.loads(data)
                msg_type = msg_data.get("type")
                
                if msg_type == "ping":
                    pong_msg = OutgoingMessage(type="pong", content="").model_dump_json()
                    await manager.send_personal_message(pong_msg, websocket)
                    
                elif msg_type == "echo":
                    content = msg_data.get("content", "")
                    echo_msg = OutgoingMessage(type="echo", content=f"Echo: {content}").model_dump_json()
                    await manager.send_personal_message(echo_msg, websocket)
                    
                elif msg_type == "broadcast":
                    content = msg_data.get("content", "")
                    broadcast_msg = OutgoingMessage(type="broadcast", content=content, sender="Client").model_dump_json()
                    await manager.broadcast(broadcast_msg, room_id)
                    
                else:
                    err_msg = ErrorMessage(code=4001, content=f"Unknown message type: {msg_type}").model_dump_json()
                    await manager.send_personal_message(err_msg, websocket)
            except json.JSONDecodeError:
                err_msg = ErrorMessage(code=4000, content="Invalid JSON payload").model_dump_json()
                await manager.send_personal_message(err_msg, websocket)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)

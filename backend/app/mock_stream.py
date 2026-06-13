import asyncio
import random
from app.websocket_manager import manager
from app.schemas import OutgoingMessage

CANDIDATES = ["John Doe", "Jane Smith", "Alice Johnson", "Bob Williams"]
STAGES = ["Applied", "Screening", "Interview", "Offer", "Rejected"]

async def generate_mock_events():
    """
    Background task that emits random candidate events every 5-10 seconds
    to simulate real-time dashboard activity.
    """
    while True:
        await asyncio.sleep(random.randint(5, 10))
        
        candidate = random.choice(CANDIDATES)
        stage = random.choice(STAGES)
        
        content = f"{candidate} moved to {stage}"
        
        # Broadcast the mock event to the 'global' room
        message = OutgoingMessage(
            type="candidate_update",
            content=content,
            sender="System"
        ).model_dump_json()
        
        await manager.broadcast(message, room_id="global")

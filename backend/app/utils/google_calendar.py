import logging
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from app.config import settings

logger = logging.getLogger(__name__)

def get_calendar_service(recruiter_id=None, db=None):
    refresh_token = settings.GOOGLE_REFRESH_TOKEN
    client_id = settings.GOOGLE_CLIENT_ID
    client_secret = settings.GOOGLE_CLIENT_SECRET
    
    if recruiter_id and db:
        try:
            from app.models.user import User
            # Query the database to find recruiter-specific credentials
            user = db.query(User).filter(User.id == recruiter_id).first()
            if user:
                if user.google_refresh_token:
                    refresh_token = user.google_refresh_token
                if user.google_client_id:
                    client_id = user.google_client_id
                if user.google_client_secret:
                    client_secret = user.google_client_secret
        except Exception as err:
            logger.error(f"Error fetching recruiter OAuth credentials: {err}")

    if not client_id or not client_secret or not refresh_token:
        logger.warning(f"Google Calendar credentials (recruiter: {recruiter_id}) are not fully configured. Calendar features will run in SIMULATION mode.")
        return None
    try:
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret
        )
        return build('calendar', 'v3', credentials=creds)
    except Exception as e:
        logger.error(f"Error creating Google Calendar client: {e}")
        return None

def create_calendar_event(summary: str, description: str, candidate_email: str, start_time: datetime, duration_minutes: int = 30, recruiter_id=None, db=None) -> str:
    service = get_calendar_service(recruiter_id=recruiter_id, db=db)
    end_time = start_time + timedelta(minutes=duration_minutes)
    
    event_body = {
        'summary': summary,
        'description': description,
        'start': {
            'dateTime': start_time.isoformat(),
            'timeZone': 'UTC',
        },
        'end': {
            'dateTime': end_time.isoformat(),
            'timeZone': 'UTC',
        },
        'attendees': [
            {'email': candidate_email},
        ],
        'reminders': {
            'useDefault': True,
        },
    }
    
    if not service:
        # Simulation mode
        import uuid
        sim_id = f"sim-cal-{uuid.uuid4()}"
        logger.info(f"[SIMULATION] Created Calendar Event {sim_id} for {candidate_email} at {start_time}")
        return sim_id

    try:
        calendar_id = settings.ORGANIZER_CALENDAR_ID or 'primary'
        # Set sendUpdates to 'none' to suppress native Google Calendar email notifications
        event = service.events().insert(calendarId=calendar_id, body=event_body, sendUpdates='none').execute()
        event_id = event.get('id')
        logger.info(f"Google Calendar Event created successfully: {event_id}")
        return event_id
    except Exception as e:
        logger.error(f"Error inserting Google Calendar event: {e}")
        import uuid
        return f"sim-cal-err-{uuid.uuid4()}"

def update_calendar_event(event_id: str, start_time: datetime, duration_minutes: int = 30, recruiter_id=None, db=None) -> bool:
    if event_id.startswith("sim-cal"):
        logger.info(f"[SIMULATION] Updated Calendar Event {event_id} to new start time {start_time}")
        return True
        
    service = get_calendar_service(recruiter_id=recruiter_id, db=db)
    if not service:
        logger.warning(f"Google Calendar service not available. Cannot update event {event_id} (Simulation mode).")
        return True

    end_time = start_time + timedelta(minutes=duration_minutes)
    try:
        calendar_id = settings.ORGANIZER_CALENDAR_ID or 'primary'
        event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        event['start'] = {'dateTime': start_time.isoformat(), 'timeZone': 'UTC'}
        event['end'] = {'dateTime': end_time.isoformat(), 'timeZone': 'UTC'}
        
        # Set sendUpdates to 'none' to suppress native Google Calendar email notifications
        service.events().update(calendarId=calendar_id, eventId=event_id, body=event, sendUpdates='none').execute()
        logger.info(f"Google Calendar Event updated successfully: {event_id}")
        return True
    except Exception as e:
        logger.error(f"Error updating Google Calendar event {event_id}: {e}")
        return False

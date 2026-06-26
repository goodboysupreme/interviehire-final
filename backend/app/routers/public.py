from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import logging

from app.database import get_db
from app.models.applicant import Applicant, InterviewStatus
from app.models.job import Job
from app.models.user import User
from app.config import settings
from app.utils.google_calendar import create_calendar_event, update_calendar_event
from app.utils.email_sender import send_ical_invitation_email

from google_auth_oauthlib.flow import Flow

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/oauth/connect")
def oauth_connect(user_id: str):
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Google OAuth client credentials are not configured globally.")
        
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=["https://www.googleapis.com/auth/calendar"],
        # No session store between /oauth/connect and /oauth2callback to carry a
        # PKCE code_verifier, so disable PKCE (classic web flow uses the client
        # secret). Otherwise Google returns "Missing code verifier" at exchange.
        autogenerate_code_verifier=False,
    )
    flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        state=user_id
    )
    return RedirectResponse(authorization_url)

@router.get("/oauth2callback")
def oauth2callback(code: str, state: str, db: Session = Depends(get_db)):
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Google OAuth client credentials are not configured globally.")
        
    user_id = state
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=["https://www.googleapis.com/auth/calendar"],
        autogenerate_code_verifier=False,
    )
    flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
    flow.fetch_token(code=code)
    credentials = flow.credentials
    
    try:
        user_uuid = UUID(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID in state.")
        
    user = db.query(User).filter(User.id == user_uuid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Only the refresh token is needed; get_calendar_service() reads the client
    # id/secret from global settings, so we don't persist them per-user (avoids a
    # dependency on optional google_client_* columns).
    if credentials.refresh_token:
        user.google_refresh_token = credentials.refresh_token
    db.commit()
    
    return HTMLResponse(content="""
    <html>
        <head>
            <title>Connection Successful</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background-color: #0b0f19; color: #f3f4f6; text-align: center; padding: 100px 20px; }
                .container { max-width: 500px; margin: 0 auto; background: #1e293b; padding: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); }
                h1 { color: #10b981; }
                p { font-size: 18px; color: #94a3b8; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Google Calendar Connected!</h1>
                <p>Your calendar has been successfully connected to IntervieHire.</p>
                <p>You can close this tab now.</p>
            </div>
        </body>
    </html>
    """)

@router.get("/schedule/{token}")
def get_public_schedule_info(token: str, db: Session = Depends(get_db)):
    applicant = db.query(Applicant).filter(Applicant.scheduling_token == token).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Invalid or expired scheduling token.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    
    stage = "Resume"
    scheduled_at = None
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        scheduled_at = applicant.functional_scheduled_at
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        scheduled_at = applicant.screening_scheduled_at
        
    return {
        "candidate_name": applicant.name,
        "email": applicant.email,
        "job_title": job_title,
        "stage": stage,
        "scheduled_at": scheduled_at.isoformat() if scheduled_at else None
    }

@router.get("/interview-session/{session_id}")
def get_public_interview_session_info(session_id: UUID, db: Session = Depends(get_db)):
    applicant = db.query(Applicant).filter(Applicant.id == session_id).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    
    stage = "Resume"
    scheduled_at = None
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        scheduled_at = applicant.functional_scheduled_at
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        scheduled_at = applicant.screening_scheduled_at
        
    return {
        "candidate_name": applicant.name,
        "email": applicant.email,
        "job_title": job_title,
        "stage": stage,
        "scheduled_at": scheduled_at.isoformat() if scheduled_at else None
    }


@router.post("/interview-session/{applicant_id}/ensure")
def ensure_interview_session(applicant_id: UUID, db: Session = Depends(get_db)):
    """Self-healing provisioning for the candidate interview room.

    The room is keyed by the applicant id as the session id (the scheduled email
    link is `.../interviewcandidateroom?sessionId={applicant.id}`). The engine
    only finds a session when `sync_applicant_to_ai` created an InterviewSession
    with `id == applicant.id`. If the candidate reaches the room before that sync
    ran (or it failed), the engine 404s with "Session not found". The engine
    calls this endpoint server-to-server when it can't find the session, so the
    link always works regardless of how the candidate arrived.

    IMPORTANT: `sync_applicant_to_ai` RESETS the session (clears transcript +
    evaluation), so the engine MUST only call this when the session is genuinely
    missing — never after the interview has produced data.
    """
    applicant = db.query(Applicant).filter(Applicant.id == applicant_id).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Applicant not found.")

    from app.utils.ai_sync import sync_applicant_to_ai
    session = sync_applicant_to_ai(db, applicant)
    if not session:
        raise HTTPException(status_code=500, detail="Failed to provision interview session.")

    return {
        "session_id": str(session.id),
        "status": session.status.value if session.status else "SCHEDULED",
    }


@router.get("/confirm/{token}", response_class=HTMLResponse)
def confirm_interview_slot(token: str, db: Session = Depends(get_db)):
    applicant = db.query(Applicant).filter(Applicant.scheduling_token == token).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Invalid or expired scheduling token.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    recruiter_id = job.created_by_id if job else None
    
    # Resolve organizer name and email from Organisation
    from app.models.organisation import Organisation
    organizer_name = "IntervieHire Host"
    organizer_email = settings.SMTP_FROM or "hr@interviehire.com"
    if job and job.organisation_id:
        org = db.query(Organisation).filter(Organisation.id == job.organisation_id).first()
        if org:
            if org.org_name:
                organizer_name = org.org_name
            if org.contact_email:
                organizer_email = org.contact_email

    stage = "Interview"
    proposed_time = None
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        if not applicant.functional_scheduled_at:
            # Set default timer to 1 PM next day
            now = datetime.utcnow()
            applicant.functional_scheduled_at = (now + timedelta(days=1)).replace(hour=13, minute=0, second=0, microsecond=0)
        proposed_time = applicant.functional_scheduled_at
        applicant.functional_status = InterviewStatus.scheduled
        try:
            from app.utils.ai_sync import sync_applicant_to_ai
            sync_applicant_to_ai(db, applicant)
        except Exception as sync_err:
            logger.error(f"Failed to sync applicant to AI database: {sync_err}")
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        if not applicant.screening_scheduled_at:
            # Set default timer to 1 PM next day
            now = datetime.utcnow()
            applicant.screening_scheduled_at = (now + timedelta(days=1)).replace(hour=13, minute=0, second=0, microsecond=0)
        proposed_time = applicant.screening_scheduled_at
        applicant.screening_status = InterviewStatus.scheduled
        
    if not proposed_time:
        raise HTTPException(status_code=400, detail="No proposed time is set for the interview.")

    # Reset sequence to 0 on initial confirm
    applicant.calendar_sequence = 0

    # Create google calendar event
    summary = f"{stage} - {applicant.name}"
    desc = f"Interview scheduled for the {job_title} role at IntervieHire."
    
    try:
        event_id = create_calendar_event(
            summary=summary,
            description=desc,
            candidate_email=applicant.email,
            start_time=proposed_time,
            recruiter_id=recruiter_id,
            db=db
        )
        applicant.calendar_event_id = event_id
    except Exception as cal_err:
        logger.error(f"Failed to create Google Calendar event: {cal_err}")
        
    db.commit()
    db.refresh(applicant)
    
    # Send custom MIME/iCalendar confirmation email
    reschedule_link = f"{settings.FRONTEND_URL}/reschedule.html?token={applicant.scheduling_token}"
    interview_link = f"{settings.INTERVIEW_ROOM_URL.rstrip('/')}/interviewcandidateroom?sessionId={applicant.id}"
    uid = f"interview-{stage.lower().replace(' ', '-')}-{applicant.id}@interviehire.com"
    
    try:
        send_ical_invitation_email(
            candidate_name=applicant.name,
            candidate_email=applicant.email,
            job_title=job_title,
            stage_name=stage,
            start_time=proposed_time,
            duration_minutes=30,
            uid=uid,
            sequence=0,
            organizer_email=organizer_email,
            reschedule_link=reschedule_link,
            interview_link=interview_link,
            organizer_name=organizer_name
        )
    except Exception as mail_err:
        logger.error(f"Failed to send confirmation email: {mail_err}")
        
    time_str = proposed_time.strftime("%B %d, %Y at %I:%M %p UTC")
    
    return f"""
    <html>
        <head>
            <title>Interview Confirmed</title>
            <style>
                body {{
                    font-family: 'Segoe UI', sans-serif;
                    background-color: #0b0f19;
                    color: #f3f4f6;
                    text-align: center;
                    padding: 80px 20px;
                    margin: 0;
                }}
                .container {{
                    max-width: 500px;
                    margin: 0 auto;
                    background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 16px;
                    padding: 40px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
                }}
                h1 {{ color: #38bdf8; margin-bottom: 20px; }}
                p {{ font-size: 16px; line-height: 1.6; color: #94a3b8; }}
                .time {{
                    font-size: 18px;
                    font-weight: bold;
                    color: #f3f4f6;
                    background: rgba(56, 189, 248, 0.05);
                    padding: 15px;
                    border-radius: 8px;
                    margin: 20px 0;
                    border: 1px solid rgba(56, 189, 248, 0.2);
                }}
                .btn {{
                    display: inline-block;
                    background-color: #38bdf8;
                    color: #0f172a;
                    text-decoration: none;
                    padding: 12px 30px;
                    font-weight: bold;
                    border-radius: 8px;
                    margin-top: 20px;
                }}
                .btn:hover {{ background-color: #7dd3fc; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Interview Confirmed!</h1>
                <p>Thank you. Your {stage} has been scheduled for the following time:</p>
                <div class="time">{time_str}</div>
                <p>A calendar invitation has been sent to your email with details and the join link.</p>
                <a href="{interview_link}" class="btn">Go to Interview Room</a>
            </div>
        </body>
    </html>
    """

@router.post("/reschedule/{token}")
def public_reschedule_interview(
    token: str,
    new_time: str = Body(..., embed=True),
    db: Session = Depends(get_db)
):
    applicant = db.query(Applicant).filter(Applicant.scheduling_token == token).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Invalid or expired scheduling token.")
        
    try:
        parsed_time = datetime.fromisoformat(new_time.replace('Z', '+00:00'))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ISO datetime format.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    recruiter_id = job.created_by_id if job else None

    # Resolve organizer name and email from Organisation
    from app.models.organisation import Organisation
    organizer_name = "IntervieHire Host"
    organizer_email = settings.SMTP_FROM or "hr@interviehire.com"
    if job and job.organisation_id:
        org = db.query(Organisation).filter(Organisation.id == job.organisation_id).first()
        if org:
            if org.org_name:
                organizer_name = org.org_name
            if org.contact_email:
                organizer_email = org.contact_email

    stage = "Interview"
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        applicant.functional_scheduled_at = parsed_time
        applicant.functional_status = InterviewStatus.scheduled
        try:
            from app.utils.ai_sync import sync_applicant_to_ai
            sync_applicant_to_ai(db, applicant)
        except Exception as sync_err:
            logger.error(f"Failed to sync rescheduled applicant to AI database: {sync_err}")
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        applicant.screening_scheduled_at = parsed_time
        applicant.screening_status = InterviewStatus.scheduled
    
    # Increment sequence counter for updates
    applicant.calendar_sequence = (applicant.calendar_sequence or 0) + 1
    
    if applicant.calendar_event_id:
        try:
            update_calendar_event(
                applicant.calendar_event_id,
                parsed_time,
                recruiter_id=recruiter_id,
                db=db
            )
        except Exception as cal_err:
            logger.error(f"Failed to update Google Calendar event: {cal_err}")
        
    db.commit()
    db.refresh(applicant)
    
    reschedule_link = f"{settings.FRONTEND_URL}/reschedule.html?token={applicant.scheduling_token}"
    interview_link = f"{settings.INTERVIEW_ROOM_URL.rstrip('/')}/interviewcandidateroom?sessionId={applicant.id}"
    uid = f"interview-{stage.lower().replace(' ', '-')}-{applicant.id}@interviehire.com"

    try:
        send_ical_invitation_email(
            candidate_name=applicant.name,
            candidate_email=applicant.email,
            job_title=job_title,
            stage_name=stage,
            start_time=parsed_time,
            duration_minutes=30,
            uid=uid,
            sequence=applicant.calendar_sequence,
            organizer_email=organizer_email,
            reschedule_link=reschedule_link,
            interview_link=interview_link,
            organizer_name=organizer_name
        )
    except Exception as mail_err:
        logger.error(f"Failed to send rescheduled confirmation email: {mail_err}")
    
    return {"status": "success", "new_scheduled_time": parsed_time.isoformat()}


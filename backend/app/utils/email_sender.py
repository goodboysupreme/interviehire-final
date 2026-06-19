import smtplib
import logging
import base64
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings

logger = logging.getLogger(__name__)

def send_email_via_resend(to_email: str, subject: str, html_content: str, attachment_content: str | None = None, attachment_name: str | None = None) -> bool:
    if not settings.RESEND_API_KEY:
        raise RuntimeError("Resend API Key is not configured.")

    from_email = settings.SMTP_FROM or "onboarding@resend.dev"
    if not settings.SMTP_FROM or "interviehire.com" in settings.SMTP_FROM or "example.com" in settings.SMTP_FROM:
        if settings.SMTP_FROM == "hr@interviehire.com":
            from_email = "onboarding@resend.dev"

    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    if attachment_content and attachment_name:
        encoded_content = base64.b64encode(attachment_content.encode('utf-8')).decode('utf-8')
        payload["attachments"] = [
            {
                "content": encoded_content,
                "filename": attachment_name
            }
        ]

    try:
        response = requests.post("https://api.resend.com/emails", json=payload, headers=headers)
        if response.status_code in [200, 201]:
            logger.info(f"Email sent successfully via Resend API to {to_email}")
            return True
        else:
            logger.error(f"Failed to send email via Resend API: {response.text}")
            raise RuntimeError(f"Resend API error: {response.text}")
    except Exception as e:
        logger.error(f"Error sending email via Resend to {to_email}: {e}")
        raise e

def send_html_email(to_email: str, subject: str, html_content: str) -> bool:
    if settings.RESEND_API_KEY:
        return send_email_via_resend(to_email, subject, html_content)

    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        logger.warning(f"SMTP credentials not configured. Email to {to_email} will run in SIMULATION mode.")
        print(f"\n==================== [SIMULATION EMAIL] ====================\nTo: {to_email}\nSubject: {subject}\n============================================================\n")
        return True

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = settings.SMTP_FROM or "hr@interviehire.com"
    msg['To'] = to_email

    part2 = MIMEText(html_content, 'html')
    msg.attach(part2)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM or "hr@interviehire.com", to_email, msg.as_string())
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Error sending email to {to_email}: {e}")
        logger.info(f"[FALLBACK SIMULATION EMAIL] To: {to_email}\nSubject: {subject}\nContent:\n{html_content}\n")
        return True

from datetime import datetime

def send_stage_invitation_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    stage_name: str,
    proposed_time: datetime,
    confirm_link: str,
    reschedule_link: str
) -> bool:
    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        box = f"""
#################################################################
# [SIMULATION EMAIL INVITATION]
# Candidate: {candidate_name} ({candidate_email})
# Stage: {stage_name} for {job_title}
# Proposed Time: {proposed_time.strftime('%B %d, %Y at %I:%M %p UTC')}
#
# Confirm Link:
# {confirm_link}
#
# Reschedule Link:
# {reschedule_link}
#################################################################
"""
        print(box)

    subject = f"Action Required: Confirm or Reschedule your {stage_name} for {job_title}"
    time_str = proposed_time.strftime("%B %d, %Y at %I:%M %p UTC")
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Interview Scheduling Invitation</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #0b0f19;
                color: #f3f4f6;
                margin: 0;
                padding: 40px 0;
            }}
            .card {{
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 40px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
            }}
            h2 {{
                color: #fbbf24;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 15px;
                margin-top: 0;
                font-size: 24px;
            }}
            p {{
                line-height: 1.6;
                font-size: 15px;
            }}
            .time-box {{
                background: rgba(251, 191, 36, 0.05);
                border-left: 4px solid #fbbf24;
                padding: 20px;
                margin: 25px 0;
                border-radius: 0 12px 12px 0;
            }}
            .time-label {{
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #94a3b8;
                margin-bottom: 5px;
            }}
            .time-value {{
                font-size: 18px;
                font-weight: bold;
                color: #f3f4f6;
            }}
            .btn-group {{
                margin: 30px 0;
                text-align: center;
            }}
            .btn {{
                display: inline-block;
                background-color: #fbbf24;
                color: #0f172a;
                text-decoration: none;
                padding: 12px 24px;
                font-weight: bold;
                border-radius: 8px;
                margin: 10px;
                text-align: center;
                transition: all 0.2s ease;
            }}
            .btn:hover {{
                background-color: #fcd34d;
                transform: translateY(-2px);
            }}
            .btn-secondary {{
                background-color: rgba(255, 255, 255, 0.05);
                color: #f3f4f6;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }}
            .btn-secondary:hover {{
                background-color: rgba(255, 255, 255, 0.1);
            }}
            .footer {{
                font-size: 12px;
                color: #64748b;
                margin-top: 40px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Schedule your {stage_name}</h2>
            <p>Dear {candidate_name},</p>
            <p>Congratulations! Your profile has been advanced to the <strong>{stage_name}</strong> round for the <strong>{job_title}</strong> position.</p>
            <p>We have proposed the following interview slot for you:</p>
            
            <div class="time-box">
                <div class="time-label">Proposed Date & Time</div>
                <div class="time-value">{time_str}</div>
            </div>
            
            <p>Please click one of the options below to confirm this slot or select a different time that works for you:</p>
            
            <div class="btn-group">
                <a href="{confirm_link}" class="btn">Confirm Proposed Slot</a>
                <a href="{reschedule_link}" class="btn btn-secondary">Reschedule Slot</a>
            </div>
            
            <div class="footer">
                <p>This is an automated message from the IntervieHire Recruitment Platform.</p>
            </div>
        </div>
    </body>
    </html>
    """
    return send_html_email(candidate_email, subject, html)

def send_ical_invitation_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    stage_name: str,
    start_time: datetime,
    duration_minutes: int,
    uid: str,
    sequence: int,
    organizer_email: str,
    reschedule_link: str,
    interview_link: str,
    organizer_name: str = "IntervieHire Host"
) -> bool:
    subject = f"Confirmed: {stage_name} Scheduled - {job_title}"
    time_str = start_time.strftime("%B %d, %Y at %I:%M %p UTC")
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Interview Confirmed</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #0b0f19;
                color: #f3f4f6;
                margin: 0;
                padding: 40px 0;
            }}
            .card {{
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 40px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
            }}
            h2 {{
                color: #38bdf8;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 15px;
                margin-top: 0;
                font-size: 24px;
            }}
            p {{
                line-height: 1.6;
                font-size: 15px;
            }}
            .time-box {{
                background: rgba(56, 189, 248, 0.05);
                border-left: 4px solid #38bdf8;
                padding: 20px;
                margin: 25px 0;
                border-radius: 0 12px 12px 0;
            }}
            .time-label {{
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #94a3b8;
                margin-bottom: 5px;
            }}
            .time-value {{
                font-size: 18px;
                font-weight: bold;
                color: #f3f4f6;
            }}
            .btn-group {{
                margin: 30px 0;
                text-align: center;
            }}
            .btn {{
                display: inline-block;
                background-color: #38bdf8;
                color: #0f172a;
                text-decoration: none;
                padding: 12px 30px;
                font-weight: bold;
                border-radius: 8px;
                margin: 10px;
                text-align: center;
                transition: all 0.2s ease;
            }}
            .btn:hover {{
                background-color: #7dd3fc;
                transform: translateY(-2px);
            }}
            .btn-secondary {{
                background-color: rgba(255, 255, 255, 0.05);
                color: #f3f4f6;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }}
            .btn-secondary:hover {{
                background-color: rgba(255, 255, 255, 0.1);
            }}
            .footer {{
                font-size: 12px;
                color: #64748b;
                margin-top: 40px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>{stage_name} Confirmed</h2>
            <p>Dear {candidate_name},</p>
            <p>Your <strong>{stage_name}</strong> for the <strong>{job_title}</strong> role has been confirmed and scheduled on your calendar. Details are listed below:</p>
            
            <div class="time-box">
                <div class="time-label">Interview Date & Time</div>
                <div class="time-value">{time_str}</div>
            </div>
            
            <p>To join the interactive interview at the scheduled time, please use the button below:</p>
            
            <div class="btn-group">
                <a href="{interview_link}" class="btn">Enter Interview Room</a>
                <a href="{reschedule_link}" class="btn btn-secondary">Reschedule Interview</a>
            </div>

            <p>If you need to check details directly in your calendar, an interactive invitation has been attached to this email.</p>

            <div class="footer">
                <p>This is an automated message from the IntervieHire AI Recruitment Platform.</p>
            </div>
        </div>
    </body>
    </html>
    """

    from datetime import timedelta
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    import smtplib

    end_time = start_time + timedelta(minutes=duration_minutes)
    
    def format_ical_date(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    dtstamp = format_ical_date(datetime.utcnow())
    dtstart = format_ical_date(start_time)
    dtend = format_ical_date(end_time)

    # iCalendar body (RFC 5545 formatted, using CRLF lines)
    ical_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//IntervieHire//NONSGML Interview Platform//EN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"SEQUENCE:{sequence}",
        "STATUS:CONFIRMED",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
        f"SUMMARY:{stage_name} - {candidate_name} ({job_title})",
        f"DESCRIPTION:Join your interactive AI interview session directly at: {interview_link}",
        f"LOCATION:{interview_link}",
        f"ORGANIZER;CN=\"{organizer_name}\":mailto:{organizer_email}",
        f"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=\"{candidate_name}\":mailto:{candidate_email}",
        "END:VEVENT",
        "END:VCALENDAR"
    ]
    ical_string = "\r\n".join(ical_lines)

    if settings.RESEND_API_KEY:
        return send_email_via_resend(
            candidate_email,
            subject,
            html_content,
            attachment_content=ical_string,
            attachment_name="invite.ics"
        )

    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        box = f"""
#################################################################
# [SIMULATION iCAL CONFIRMATION]
# Candidate: {candidate_name} ({candidate_email})
# Stage: {stage_name} for {job_title}
# Start Time: {start_time.strftime('%B %d, %Y at %I:%M %p UTC')}
#
# Interview Link:
# {interview_link}
#
# Reschedule Link:
# {reschedule_link}
#################################################################
"""
        print(box)
        logger.warning(f"SMTP credentials not configured. iCalendar Email to {candidate_email} will run in SIMULATION mode.")
        print(f"\n==================== [SIMULATION iCAL EMAIL] ====================\nTo: {candidate_email}\nSubject: {subject}\n=================================================================\n")
        return True

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    from_email = settings.SMTP_FROM or "hr@interviehire.com"
    msg['From'] = f"{organizer_name} <{from_email}>"
    msg['To'] = candidate_email

    # Plain text alternative
    plain_text = f"Confirmed: {stage_name} for {job_title} on {time_str}.\nJoin using: {interview_link}\nReschedule using: {reschedule_link}"
    msg.attach(MIMEText(plain_text, 'plain'))
    
    # HTML alternative
    msg.attach(MIMEText(html_content, 'html'))

    # Calendar attachment
    part_cal = MIMEText(ical_string, 'calendar; method=REQUEST')
    part_cal.set_param('method', 'REQUEST')
    part_cal.set_param('name', 'invite.ics')
    part_cal.add_header('Content-Class', 'urn:content-classes:calendarmessage')
    msg.attach(part_cal)

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM or "hr@interviehire.com", candidate_email, msg.as_string())
        logger.info(f"iCalendar Email sent successfully to {candidate_email}")
        return True
    except Exception as e:
        logger.error(f"Error sending iCalendar email to {candidate_email}: {e}")
        return False

def send_reschedule_confirmation_email(candidate_name: str, candidate_email: str, job_title: str, stage_name: str, new_time_str: str) -> bool:
    # Deprecated/Fallback: Redirecting reschedules directly through multi-part RFC invites above
    subject = f"Confirmed: Your {stage_name} has been rescheduled"
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Interview Reschedule Confirmation</title>
        <style>
            body {{ font-family: Arial, sans-serif; background-color: #0d0d0d; color: #e0e0e0; margin: 0; padding: 40px 0; }}
            .card {{ max-width: 600px; margin: 0 auto; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 30px; }}
            h2 {{ color: #22c55e; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 10px; margin-top: 0; }}
            p {{ line-height: 1.6; font-size: 15px; }}
            .time-box {{ background: rgba(255, 255, 255, 0.05); border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; border-radius: 0 6px 6px 0; font-size: 16px; font-weight: bold; }}
            .footer {{ font-size: 12px; color: #888888; margin-top: 30px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 15px; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Interview Confirmed</h2>
            <p>Dear {candidate_name},</p>
            <p>Your <strong>{stage_name}</strong> for the <strong>{job_title}</strong> position has been scheduled. Details are below:</p>
            <div class="time-box">
                Interview Time: {new_time_str}
            </div>
            <p>A calendar invitation has also been sent to your email. We look forward to speaking with you.</p>
            <div class="footer">
                <p>This is an automated message from IntervieHire Recruitment Platform.</p>
            </div>
        </div>
    </body>
    </html>
    """
    return send_html_email(candidate_email, subject, html)


import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Explicitly load .env file from the parent directory of this file
_current_dir = os.path.dirname(os.path.abspath(__file__))
_env_path = os.path.join(_current_dir, "..", ".env")
load_dotenv(_env_path)


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/hiring_dashboard"
 
    # App
    SECRET_KEY: str = "change-this-in-production"
    APP_NAME: str = "Hiring Dashboard"
 
    # CORS — the recruiter dashboard origin
    FRONTEND_URL: str = "http://localhost:3000"

    # The candidate interview room base URL (the engine web app). The emailed
    # calendar invite's "Enter Interview Room" link points here, so it opens the
    # SAME AI interview room that "Run test interview" uses. Local: :3001.
    # Production: https://interview.interviehire.com
    INTERVIEW_ROOM_URL: str = "http://localhost:3001"

    # SMTP Settings
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str = "hr@interviehire.com"

    # Google OAuth 2.0 Credentials
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REFRESH_TOKEN: str | None = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/public/oauth2callback"
    ORGANIZER_CALENDAR_ID: str = "primary"
    WEBHOOK_SECRET: str = "super-secret-webhook-key"

    # API Keys
    GROQ_API_KEY: str | None = None
    GROK_API_KEY: str | None = None
    XAI_API_KEY: str | None = None
    GEMINI_API_KEY: str | None = None
    DEEPSEEK_API_KEY: str | None = None

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
 
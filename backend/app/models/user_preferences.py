from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.database import Base


class UserPreferences(Base):
    """Per-account preference store.

    One row per user, created on-demand (upsert) so existing accounts
    don't need a seed record. Starts with ``theme='dark'`` as default.
    """
    __tablename__ = "user_preferences"

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    theme = Column(String, nullable=False, default="dark")  # 'dark' | 'light' | 'system'
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

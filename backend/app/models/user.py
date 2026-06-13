from sqlalchemy import Column, String, DateTime, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.database import Base


class UserStatus(str, enum.Enum):
    active = "active"
    invited = "invited"
    inactive = "inactive"


class UserType(str, enum.Enum):
    super_admin = "super_admin"
    org_admin = "org_admin"
    member = "member"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    designation = Column(String, nullable=True)
    user_type = Column(Enum(UserType), default=UserType.member)
    status = Column(Enum(UserStatus), default=UserStatus.invited)
    hashed_password = Column(String, nullable=True)  # null until they accept invite
    organisation_id = Column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=True)
    google_refresh_token = Column(String, nullable=True)
    google_client_id = Column(String, nullable=True)
    google_client_secret = Column(String, nullable=True)
    registered_on = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organisation = relationship("Organisation")
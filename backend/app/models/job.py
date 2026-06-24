from sqlalchemy import Column, String, DateTime, Enum, Boolean, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.database import Base


class JobStatus(str, enum.Enum):
    published = "published"
    draft = "draft"
    archived = "archived"


class Job(Base):
    __tablename__ = "jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    custom_job_id = Column(String, nullable=True)        # e.g. AKRO62EF45E26EA1
    title = Column(String, nullable=False)               # card name shown on dashboard
    role_name = Column(String, nullable=False)           # actual role
    status = Column(Enum(JobStatus), default=JobStatus.draft)
    experience_band = Column(String, nullable=True)      # e.g. "0-2 Years"
    tags = Column(String, nullable=True)
    description = Column(Text, nullable=True)            # full JD text
    location = Column(String, nullable=True)
    job_type = Column(String, nullable=True)             # Full-Time, Part-Time etc.
    is_job_listed = Column(Boolean, default=False)       # "Job Listed" badge

    # Parameters & generated questions (JSON stored as text)
    resume_parameters = Column(Text, nullable=True)
    screening_parameters = Column(Text, nullable=True)
    functional_parameters = Column(Text, nullable=True)
    screening_questions = Column(Text, nullable=True)  # JSON array of AI-generated screening interview questions
    interview_settings = Column(Text, nullable=True)   # JSON: per-job interview settings (mobile/late/cv/access/etc.)

    # Pipeline stage toggles
    resume_analysis_enabled = Column(Boolean, default=True)
    recruiter_screening_enabled = Column(Boolean, default=True)
    functional_interview_enabled = Column(Boolean, default=True)

    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    organisation_id = Column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    created_by = relationship("User", foreign_keys=[created_by_id])
    organisation = relationship("Organisation")
    applicants = relationship("Applicant", back_populates="job")
    collaborators = relationship("JobCollaborator", back_populates="job")


class JobCollaborator(Base):
    __tablename__ = "job_collaborators"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    job = relationship("Job", back_populates="collaborators")
    user = relationship("User")
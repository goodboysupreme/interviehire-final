from sqlalchemy import Column, String, DateTime, Enum, Float, ForeignKey, Text, Boolean, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.database import Base


class InterviewStatus(str, enum.Enum):
    pending = "pending"
    scheduled = "scheduled"
    completed = "completed"
    slot_missed = "slot_missed"
    incomplete = "incomplete"


class CheatProbability(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class ApplicantSource(str, enum.Enum):
    career_page = "career_page"
    bulk_upload = "bulk_upload"
    direct_link = "direct_link"
    scheduled = "scheduled"
    ats = "ats"


class Applicant(Base):
    __tablename__ = "applicants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True)
    source = Column(Enum(ApplicantSource), nullable=True)
    resume_url = Column(String, nullable=True)
    remarks = Column(Text, nullable=True)
    status = Column(String, default="Resume", nullable=True)

    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False)

    # Resume Analysis stage
    resume_analysed = Column(Boolean, default=False)
    resume_shortlisted = Column(Boolean, default=False)
    resume_waitlisted = Column(Boolean, default=False)

    # Recruiter Screening stage
    screening_status = Column(Enum(InterviewStatus), nullable=True)
    screening_score = Column(Float, nullable=True)
    screening_scheduled_at = Column(DateTime(timezone=True), nullable=True)

    # Functional Interview stage
    functional_status = Column(Enum(InterviewStatus), nullable=True)
    functional_score = Column(Float, nullable=True)
    functional_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    cheat_probability = Column(Enum(CheatProbability), nullable=True)
    report_url = Column(String, nullable=True)
    
    recruiter_screening = Column(String, nullable=True)
    recruiter_screening_score = Column(Float, nullable=True)
    attempted_at = Column(DateTime(timezone=True), nullable=True)
    match_score = Column(Float, nullable=True)
    resume_analysis_report = Column(Text, nullable=True)
    scheduling_token = Column(String, nullable=True, index=True)
    calendar_event_id = Column(String, nullable=True)
    overall_interview_score = Column(Float, nullable=True)
    proctoring_severity_flag = Column(String, nullable=True)
    calendar_sequence = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    job = relationship("Job", back_populates="applicants")
from sqlalchemy import Column, String, DateTime, Enum, Float, ForeignKey, Text, Boolean, Integer, JSON
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.database import Base

class RoleType(str, enum.Enum):
    CONSULTING = "CONSULTING"
    PRODUCT_MANAGEMENT = "PRODUCT_MANAGEMENT"
    BUSINESS_ANALYST = "BUSINESS_ANALYST"
    FOUNDERS_OFFICE = "FOUNDERS_OFFICE"
    GENERAL = "GENERAL"

class Difficulty(str, enum.Enum):
    EASY = "EASY"
    MEDIUM = "MEDIUM"
    HARD = "HARD"

class SessionStatus(str, enum.Enum):
    SCHEDULED = "SCHEDULED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    EVALUATED = "EVALUATED"
    CANCELLED = "CANCELLED"

class Severity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class Company(Base):
    __tablename__ = 'Company'

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    logoUrl = Column(String, nullable=True)
    primaryColor = Column(String, default="#0f766e", nullable=False)
    settings = Column(JSONB, default=dict, nullable=False)
    webhooks = Column(JSONB, default=dict, nullable=False)
    reportEmail = Column(String, nullable=True)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    jobRoles = relationship("JobRole", back_populates="company", cascade="all, delete-orphan")
    candidates = relationship("Candidate", back_populates="company", cascade="all, delete-orphan")
    questions = relationship("Question", back_populates="company", cascade="all, delete-orphan")
    sessions = relationship("InterviewSession", back_populates="company", cascade="all, delete-orphan")


class Candidate(Base):
    __tablename__ = 'Candidate'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    fullName = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    resumeText = Column(Text, nullable=True)
    parsedResume = Column(JSONB, default=dict, nullable=False)
    atsScore = Column(Float, default=0.0, nullable=False)
    atsBreakdown = Column(JSONB, default=dict, nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="candidates")
    sessions = relationship("InterviewSession", back_populates="candidate", cascade="all, delete-orphan")


class JobRole(Base):
    __tablename__ = 'JobRole'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    title = Column(String, nullable=False)
    roleType = Column(Enum(RoleType, name="RoleType"), default=RoleType.GENERAL, nullable=False)
    description = Column(Text, nullable=False)
    requirements = Column(Text, nullable=False)
    primaryCriteria = Column(ARRAY(String), nullable=False)
    secondaryCriteria = Column(ARRAY(String), nullable=False)
    atsScoringWeights = Column(JSONB, nullable=False)
    evaluationCriteria = Column(JSONB, default=dict, nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="jobRoles")
    questions = relationship("Question", back_populates="jobRole")
    sessions = relationship("InterviewSession", back_populates="jobRole", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = 'Question'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    jobRoleId = Column(String, ForeignKey('JobRole.id', ondelete='SET NULL'), nullable=True)
    text = Column(Text, nullable=False)
    roleApplicability = Column(ARRAY(Enum(RoleType, name="RoleType")), nullable=False)
    difficulty = Column(Enum(Difficulty, name="Difficulty"), default=Difficulty.MEDIUM, nullable=False)
    topicCategories = Column(ARRAY(String), nullable=False)
    estimatedMinutes = Column(Integer, default=4, nullable=False)
    aiEvaluationGuidance = Column(Text, nullable=False)
    effectivenessRating = Column(Float, default=0.0, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    isActive = Column(Boolean, default=True, nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="questions")
    jobRole = relationship("JobRole", back_populates="questions")


class InterviewSession(Base):
    __tablename__ = 'InterviewSession'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    candidateId = Column(String, ForeignKey('Candidate.id', ondelete='CASCADE'), nullable=False)
    jobRoleId = Column(String, ForeignKey('JobRole.id', ondelete='CASCADE'), nullable=False)
    status = Column(Enum(SessionStatus, name="SessionStatus"), default=SessionStatus.SCHEDULED, nullable=False)
    websocketId = Column(String, nullable=True)
    ueSocketId = Column(String, nullable=True)
    startedAt = Column(DateTime(timezone=True), nullable=True)
    completedAt = Column(DateTime(timezone=True), nullable=True)
    scheduledAt = Column(DateTime(timezone=True), nullable=True)
    transcript = Column(JSONB, default=list, nullable=False)
    avatarProvider = Column(String, default="ue5_pixel_streaming", nullable=False)
    evaluation = Column(JSONB, nullable=True)
    reportUrl = Column(String, nullable=True)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="sessions")
    candidate = relationship("Candidate", back_populates="sessions")
    jobRole = relationship("JobRole", back_populates="sessions")
    proctoringLogs = relationship("ProctoringLog", back_populates="session", cascade="all, delete-orphan")


class ProctoringLog(Base):
    __tablename__ = 'ProctoringLog'

    id = Column(String, primary_key=True)
    sessionId = Column(String, ForeignKey('InterviewSession.id', ondelete='CASCADE'), nullable=False)
    eventType = Column(String, nullable=False)
    severity = Column(Enum(Severity, name="Severity"), nullable=False)
    meta_data = Column('metadata', JSONB, default=dict, nullable=False)
    occurredAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("InterviewSession", back_populates="proctoringLogs")

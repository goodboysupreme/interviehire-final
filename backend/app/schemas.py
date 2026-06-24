from pydantic import BaseModel, Field
from typing import Any, Dict, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Literal
from datetime import datetime
from uuid import UUID
from app.models.user import UserStatus, UserType
from app.models.job import JobStatus
from app.models.applicant import InterviewStatus, CheatProbability, ApplicantSource
 

class BaseWSMessage(BaseModel):
    type: str

class IncomingMessage(BaseWSMessage):
    content: Optional[str] = None

class OutgoingMessage(BaseWSMessage):
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    sender: Optional[str] = None

class ErrorMessage(BaseWSMessage):
    type: str = "error"
    code: int
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class UserOut(BaseModel):
    id: UUID
    name: str
    email: str
    designation: Optional[str]
    user_type: UserType
    status: UserStatus
    registered_on: Optional[datetime]
 
    class Config:
        from_attributes = True
 
class TeamListOut(BaseModel):
    members: List[UserOut]
    total: int
    active: int
    invited: int
    inactive: int
 
class InviteMemberIn(BaseModel):
    name: str
    email: EmailStr
    designation: Optional[str] = None
    user_type: UserType = UserType.member

class UpdateMemberIn(BaseModel):
    designation: Optional[str] = None
    user_type: Optional[UserType] = None
    status: Optional[UserStatus] = None

class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str
 
 
# ─── ORGANISATION ────────────────────────────────────────────────────────────
 
class OrganisationOut(BaseModel):
    id: UUID
    org_name: str
    domain: Optional[str]
    contact_email: Optional[str]
    website_link: Optional[str]
    location: Optional[str]
    logo_url: Optional[str]
    description: Optional[str]
 
    class Config:
        from_attributes = True
 
class OrganisationIn(BaseModel):
    org_name: str
    domain: Optional[str] = None
    contact_email: Optional[str] = None
    website_link: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
 
 
# ─── JOBS ────────────────────────────────────────────────────────────────────
 
class JobPipelineCounts(BaseModel):
    total: int
    resume: Optional[int]
    screening: int
    functional: int
 
class JobOut(BaseModel):
    id: UUID
    custom_job_id: Optional[str]
    title: str
    role_name: str
    status: JobStatus
    experience_band: Optional[str]
    description: Optional[str] = None
    is_job_listed: bool
    created_at: datetime
    created_by_name: Optional[str]
    resume_analysis_enabled: bool = True
    recruiter_screening_enabled: bool = True
    functional_interview_enabled: bool = True
    pipeline: JobPipelineCounts
    resume_parameters: Optional[dict] = None
    screening_parameters: Optional[dict] = None
    functional_parameters: Optional[dict] = None
    screening_questions: Optional[List[str]] = None
    tags: Optional[List[str]] = None

    class Config:
        from_attributes = True
 
class JobListOut(BaseModel):
    jobs: List[JobOut]
    total: int
    published: int
    draft: int
    archived: int
 
class JobDetailOut(BaseModel):
    id: UUID
    custom_job_id: Optional[str] = None
    title: str
    role_name: str
    status: JobStatus
    description: Optional[str]
    location: Optional[str]
    job_type: Optional[str]
    experience_band: Optional[str]
    is_job_listed: bool
    resume_analysis_enabled: bool
    recruiter_screening_enabled: bool
    functional_interview_enabled: bool
    created_at: datetime
    resume_parameters: Optional[dict] = None
    screening_parameters: Optional[dict] = None
    functional_parameters: Optional[dict] = None
    screening_questions: Optional[List[str]] = None
    tags: Optional[List[str]] = None
 
    class Config:
        from_attributes = True
 
class JobSettingsIn(BaseModel):
    resume_analysis_enabled: Optional[bool] = None
    recruiter_screening_enabled: Optional[bool] = None
    functional_interview_enabled: Optional[bool] = None
    is_job_listed: Optional[bool] = None
    title: Optional[str] = None
    role_name: Optional[str] = None
    experience_band: Optional[str] = None
    description: Optional[str] = None
    custom_job_id: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[JobStatus] = None
    screening_questions: Optional[List[str]] = None
    job_type: Optional[str] = None
    location: Optional[str] = None
 
class JobCreateIn(BaseModel):
    title: str
    role_name: str
    experience_band: Optional[str] = None
    custom_job_id: Optional[str] = None
    status: JobStatus = JobStatus.draft
    resume_analysis_enabled: bool = True
    recruiter_screening_enabled: bool = True
    functional_interview_enabled: bool = True
    description: Optional[str] = None
    resume_parameters: Optional[dict] = None
    screening_parameters: Optional[dict] = None
    functional_parameters: Optional[dict] = None
    screening_questions: Optional[List[str]] = None

class JobParametersIn(BaseModel):
    resume_parameters: Optional[dict] = None
    screening_parameters: Optional[dict] = None
    functional_parameters: Optional[dict] = None
    screening_questions: Optional[List[str]] = None


# ─── APPLICANTS / RESPONSES ──────────────────────────────────────────────────
 
class ApplicantOut(BaseModel):
    id: UUID
    name: str
    email: str
    phone: Optional[str]
    source: Optional[ApplicantSource]
    remarks: Optional[str]
    match_score: Optional[float] = None
    resume_analysis_report: Optional[str] = None
    resume_text: Optional[str] = None
    resume_analysed: Optional[bool] = None
    resume_shortlisted: Optional[bool] = None
    decision: Optional[str] = None

    # Screening
    screening_status: Optional[InterviewStatus]
    screening_score: Optional[float]
 
    # Functional
    functional_status: Optional[InterviewStatus]
    functional_score: Optional[float]
    cheat_probability: Optional[CheatProbability]
    report_url: Optional[str]

    recruiter_screening: Optional[str]
    recruiter_screening_score: Optional[float]
    attempted_at: Optional[datetime]
    screening_scheduled_at: Optional[datetime] = None
    functional_scheduled_at: Optional[datetime] = None
    overall_interview_score: Optional[float] = None
    proctoring_severity_flag: Optional[str] = None
    calendar_sequence: Optional[int] = 0
    scheduling_token: Optional[str] = None
    calendar_event_id: Optional[str] = None
 
    class Config:
        from_attributes = True
 
class AddApplicantIn(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    source: Optional[ApplicantSource] = None
    recruiter_screening: Optional[str] = None
    recruiter_screening_score: Optional[float] = None
    attempted_at: Optional[datetime] = None

class BulkApplicantsIn(BaseModel):
    applicants: List[AddApplicantIn]

class ApplicantUpdateIn(BaseModel):
    screening_status: Optional[InterviewStatus] = None
    screening_score: Optional[float] = None
    functional_status: Optional[InterviewStatus] = None
    functional_score: Optional[float] = None
    cheat_probability: Optional[CheatProbability] = None
    resume_analysed: Optional[bool] = None
    resume_shortlisted: Optional[bool] = None
    resume_waitlisted: Optional[bool] = None
    recruiter_screening: Optional[str] = None
    recruiter_screening_score: Optional[float] = None
    attempted_at: Optional[datetime] = None
    remarks: Optional[str] = None
    match_score: Optional[float] = None
    resume_analysis_report: Optional[str] = None
    resume_text: Optional[str] = None
    decision: Optional[Literal['shortlisted', 'on_hold', 'rejected', 'hired']] = None
    screening_scheduled_at: Optional[datetime] = None
    functional_scheduled_at: Optional[datetime] = None
    overall_interview_score: Optional[float] = None
    proctoring_severity_flag: Optional[str] = None
    calendar_sequence: Optional[int] = None
    scheduling_token: Optional[str] = None
    calendar_event_id: Optional[str] = None
 
class CollaboratorIn(BaseModel):
    user_id: UUID
 
 
# ─── USAGE / ANALYTICS ───────────────────────────────────────────────────────
 
class UsageStatsOut(BaseModel):
    total_applicants: int
    career_page: int
    bulk_upload: int
    scheduled: int
    direct_link: int
    resume_analysed: int
    resume_shortlisted: int
    resume_waitlisted: int
    screening_attempted: int
    screening_scheduled: int
    screening_shortlisted: int
    screening_waitlisted: int
    functional_attempted: int
    functional_scheduled: int
    functional_shortlisted: int
    functional_waitlisted: int
 
class JobTableRow(BaseModel):
    id: UUID
    custom_job_id: Optional[str]
    role_name: str
    title: str
    experience_band: Optional[str]
    tags: Optional[str]
    created_by_name: Optional[str]
 
    class Config:
        from_attributes = True
 
 
# ─── FUNNEL (Job Overview tab) ───────────────────────────────────────────────
 
class FunnelStage(BaseModel):
    label: str
    count: int
    conversion: Optional[float]  # percentage
 
class FunnelOut(BaseModel):
    stages: List[FunnelStage]
    score_distribution: dict   # {"0-20": 0, "20-40": 5, "40-60": 10, "60-80": 8, "80-100": 2}
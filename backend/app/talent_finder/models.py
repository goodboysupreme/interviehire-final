"""Talent Finder SQLAlchemy models — the 9 sourcing tables.

These are ADDITIVE: they don't touch the existing interview-pipeline models
(Applicant, Job, InterviewSession, …). The JobRole is the existing `jobs` table
(reused); internal candidates are the existing `applicants` table (reused). The
normalized sourced-candidate lives in `candidate_profiles`.
"""
import enum
import uuid

from sqlalchemy import Column, String, DateTime, Float, Integer, Boolean, ForeignKey, Text, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func

from app.database import Base


# ── enums ────────────────────────────────────────────────────────────────────
class SearchStatus(str, enum.Enum):
    pending = "pending"
    searching = "searching"
    normalizing = "normalizing"
    deduping = "deduping"
    ranking = "ranking"
    done = "done"
    failed = "failed"


class SourceType(str, enum.Enum):
    internal_db = "internal_db"          # existing applicants
    uploaded_csv = "uploaded_csv"
    resume_db = "resume_db"
    ats = "ats"
    career_page = "career_page"
    public_web = "public_web"
    approved_api = "approved_api"
    manual_import = "manual_import"
    restricted = "restricted"            # disabled placeholders (LinkedIn, …)


class PermissionStatus(str, enum.Enum):
    permissioned = "permissioned"        # internal / uploaded / consented
    public_allowed = "public_allowed"    # legally accessible public snippet
    user_provided = "user_provided"      # recruiter export / paste
    requires_permission = "requires_permission"  # disabled until API/consent


class ResultStatus(str, enum.Enum):
    new = "new"
    shortlisted = "shortlisted"
    rejected = "rejected"
    saved = "saved"
    invited = "invited"


class OutreachStatus(str, enum.Enum):
    none = "none"
    draft = "draft"
    approved = "approved"
    sent = "sent"
    opted_out = "opted_out"


# ── tables ───────────────────────────────────────────────────────────────────
class TalentSearch(Base):
    __tablename__ = "talent_searches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=True)
    organisation_id = Column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=True)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    status = Column(String, default=SearchStatus.pending.value, nullable=False)
    brief = Column(JSONB, default=dict, nullable=False)         # structured candidate search brief
    sources = Column(JSONB, default=list, nullable=False)       # source_types requested
    max_candidates = Column(Integer, default=50, nullable=False)

    found_count = Column(Integer, default=0, nullable=False)
    deduped_count = Column(Integer, default=0, nullable=False)
    ranked_count = Column(Integer, default=0, nullable=False)
    error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class CandidateProfile(Base):
    """Normalized sourced candidate (distinct from interview-pipeline Applicant)."""
    __tablename__ = "candidate_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id = Column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=True)

    full_name = Column(String, nullable=False)
    current_title = Column(String, nullable=True)
    current_company = Column(String, nullable=True)
    location = Column(String, nullable=True)
    email = Column(String, nullable=True)                       # only from permissioned source
    phone = Column(String, nullable=True)                       # only from permissioned source
    profile_url = Column(String, nullable=True)

    source_name = Column(String, nullable=True)
    source_type = Column(String, nullable=True)
    source_permission_status = Column(String, nullable=True)

    skills = Column(JSONB, default=list, nullable=False)
    years_of_experience = Column(Float, nullable=True)
    education = Column(JSONB, default=list, nullable=False)
    previous_companies = Column(JSONB, default=list, nullable=False)
    resume_url = Column(String, nullable=True)
    portfolio_url = Column(String, nullable=True)
    github_url = Column(String, nullable=True)
    linkedin_url = Column(String, nullable=True)                # only via compliant import
    availability_status = Column(String, nullable=True)
    salary_expectation = Column(String, nullable=True)
    notice_period = Column(String, nullable=True)

    raw_source_payload = Column(JSONB, default=dict, nullable=False)
    consent_status = Column(String, default="unknown", nullable=False)
    outreach_status = Column(String, default=OutreachStatus.none.value, nullable=False)

    # latest fit (also stored per-search in candidate_fit_scores)
    fit_score = Column(Float, nullable=True)
    fit_breakdown = Column(JSONB, default=dict, nullable=False)
    fit_reasoning = Column(Text, nullable=True)
    risk_flags = Column(JSONB, default=list, nullable=False)

    dedup_key = Column(String, nullable=True, index=True)       # for cross-source dedup
    completeness = Column(Float, default=0.0, nullable=False)   # profile completeness 0..1

    last_updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CandidateSource(Base):
    """Every source a candidate was found in — preserved across dedup merges."""
    __tablename__ = "candidate_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidate_profiles.id", ondelete="CASCADE"), nullable=False)
    source_name = Column(String, nullable=True)
    source_type = Column(String, nullable=True)
    source_permission_status = Column(String, nullable=True)
    profile_url = Column(String, nullable=True)
    raw_payload = Column(JSONB, default=dict, nullable=False)
    imported_at = Column(DateTime(timezone=True), server_default=func.now())


class TalentSearchResult(Base):
    """Join of a search → candidate, with per-search rank + recruiter status."""
    __tablename__ = "talent_search_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    search_id = Column(UUID(as_uuid=True), ForeignKey("talent_searches.id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidate_profiles.id", ondelete="CASCADE"), nullable=False)
    fit_score = Column(Float, default=0.0, nullable=False)
    rank = Column(Integer, nullable=True)
    status = Column(String, default=ResultStatus.new.value, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_tsr_search_score", "search_id", "fit_score"),)


class CandidateFitScore(Base):
    __tablename__ = "candidate_fit_scores"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidate_profiles.id", ondelete="CASCADE"), nullable=False)
    search_id = Column(UUID(as_uuid=True), ForeignKey("talent_searches.id", ondelete="CASCADE"), nullable=False)
    total_score = Column(Float, default=0.0, nullable=False)
    must_have_score = Column(Float, default=0.0, nullable=False)
    experience_score = Column(Float, default=0.0, nullable=False)
    semantic_score = Column(Float, default=0.0, nullable=False)
    location_score = Column(Float, default=0.0, nullable=False)
    good_to_have_score = Column(Float, default=0.0, nullable=False)
    risk_penalty = Column(Float, default=0.0, nullable=False)
    matched_must_haves = Column(JSONB, default=list, nullable=False)
    missing_must_haves = Column(JSONB, default=list, nullable=False)
    matched_good_to_haves = Column(JSONB, default=list, nullable=False)
    reasoning = Column(Text, nullable=True)
    recommendation = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CandidateOutreachMessage(Base):
    __tablename__ = "candidate_outreach_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id = Column(UUID(as_uuid=True), ForeignKey("candidate_profiles.id", ondelete="CASCADE"), nullable=False)
    search_id = Column(UUID(as_uuid=True), ForeignKey("talent_searches.id", ondelete="SET NULL"), nullable=True)
    channel = Column(String, default="email", nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String, default=OutreachStatus.draft.value, nullable=False)
    approved_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)


class CandidateImportBatch(Base):
    __tablename__ = "candidate_import_batches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id = Column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=True)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    source_type = Column(String, nullable=True)
    filename = Column(String, nullable=True)
    row_count = Column(Integer, default=0, nullable=False)
    imported_count = Column(Integer, default=0, nullable=False)
    skipped_count = Column(Integer, default=0, nullable=False)
    status = Column(String, default="done", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SourceAdapterConfig(Base):
    __tablename__ = "source_adapter_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id = Column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=True)
    source_name = Column(String, nullable=False)
    source_type = Column(String, nullable=False)
    is_enabled = Column(Boolean, default=False, nullable=False)
    permission_mode = Column(String, default=PermissionStatus.requires_permission.value, nullable=False)
    config = Column(JSONB, default=dict, nullable=False)        # api keys ref / endpoints (never raw secrets in logs)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TalentFinderAuditLog(Base):
    __tablename__ = "talent_finder_audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id = Column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action = Column(String, nullable=False)                     # search.run, import.csv, outreach.generate, data.delete …
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    detail = Column(JSONB, default=dict, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

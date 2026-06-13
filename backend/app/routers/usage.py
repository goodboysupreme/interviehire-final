from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
from datetime import datetime

from app.database import get_db
from app.models.job import Job, JobCollaborator
from app.models.applicant import Applicant, ApplicantSource
from app.models.user import User, UserType
from app.schemas import UsageStatsOut, JobTableRow
from app.utils.auth import get_current_user, get_active_org_id

router = APIRouter()


def _get_visible_job_ids(current_user: User, active_org_id: Optional[UUID], db: Session) -> List[UUID]:
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        return []
    
    query = db.query(Job).filter(Job.organisation_id == org_id)
    if current_user.user_type == UserType.member:
        query = query.join(Job.collaborators).filter(JobCollaborator.user_id == current_user.id)
    
    return [j.id for j in query.all()]


@router.get("/stats", response_model=UsageStatsOut)
def get_usage_stats(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    visible_job_ids = _get_visible_job_ids(current_user, active_org_id, db)
    if not visible_job_ids:
        return UsageStatsOut(
            total_applicants=0, career_page=0, bulk_upload=0, scheduled=0, direct_link=0,
            resume_analysed=0, resume_shortlisted=0, resume_waitlisted=0,
            screening_attempted=0, screening_scheduled=0, screening_shortlisted=0, screening_waitlisted=0,
            functional_attempted=0, functional_scheduled=0, functional_shortlisted=0, functional_waitlisted=0
        )

    query = db.query(Applicant).filter(Applicant.job_id.in_(visible_job_ids))
    if date_from:
        query = query.filter(Applicant.created_at >= date_from)
    if date_to:
        query = query.filter(Applicant.created_at <= date_to)

    applicants = query.all()

    return UsageStatsOut(
        total_applicants=len(applicants),
        career_page=sum(1 for a in applicants if a.source == ApplicantSource.career_page),
        bulk_upload=sum(1 for a in applicants if a.source == ApplicantSource.bulk_upload),
        scheduled=sum(1 for a in applicants if a.source == ApplicantSource.scheduled),
        direct_link=sum(1 for a in applicants if a.source == ApplicantSource.direct_link),
        resume_analysed=sum(1 for a in applicants if a.resume_analysed),
        resume_shortlisted=sum(1 for a in applicants if a.resume_shortlisted),
        resume_waitlisted=sum(1 for a in applicants if a.resume_waitlisted),
        screening_attempted=sum(1 for a in applicants if a.screening_status is not None),
        screening_scheduled=sum(1 for a in applicants if a.screening_status and a.screening_status.value == "scheduled"),
        screening_shortlisted=sum(1 for a in applicants if a.screening_score and a.screening_score >= 60),
        screening_waitlisted=0,
        functional_attempted=sum(1 for a in applicants if a.functional_status is not None),
        functional_scheduled=sum(1 for a in applicants if a.functional_status and a.functional_status.value == "scheduled"),
        functional_shortlisted=sum(1 for a in applicants if a.functional_score and a.functional_score >= 60),
        functional_waitlisted=0,
    )


@router.get("/jobs-table")
def get_jobs_table(
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        return []

    query = db.query(Job).filter(Job.organisation_id == org_id)
    if current_user.user_type == UserType.member:
        query = query.join(Job.collaborators).filter(JobCollaborator.user_id == current_user.id)

    jobs = query.all()
    return [
        {
            "id": str(j.id),
            "custom_job_id": j.custom_job_id,
            "role_name": j.role_name,
            "title": j.title,
            "experience_band": j.experience_band,
            "tags": j.tags,
            "created_by_name": j.created_by.name if j.created_by else None,
        }
        for j in jobs
    ]


@router.get("/candidates-table")
def get_candidates_table(
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    visible_job_ids = _get_visible_job_ids(current_user, active_org_id, db)
    if not visible_job_ids:
        return []

    applicants = db.query(Applicant).filter(Applicant.job_id.in_(visible_job_ids)).all()

    # Sync with InterviewSession
    from app.models.ai_integration import InterviewSession, SessionStatus, Severity
    from app.models.applicant import InterviewStatus, CheatProbability

    session_ids = [str(a.id) for a in applicants]
    sessions = db.query(InterviewSession).filter(InterviewSession.id.in_(session_ids)).all()
    sessions_by_id = {s.id: s for s in sessions}

    for a in applicants:
        s = sessions_by_id.get(str(a.id))
        if s:
            updated = False
            # Sync status
            if s.status == SessionStatus.EVALUATED:
                if a.functional_status != InterviewStatus.completed:
                    a.functional_status = InterviewStatus.completed
                    updated = True
            elif s.status == SessionStatus.IN_PROGRESS:
                if a.functional_status != InterviewStatus.scheduled:
                    a.functional_status = InterviewStatus.scheduled
                    updated = True

            # Sync score
            if s.evaluation and isinstance(s.evaluation, dict):
                score = s.evaluation.get("overallScore")
                if score is not None:
                    score = float(score)
                    if a.functional_score != score:
                        a.functional_score = score
                        updated = True

                # Sync report URL
                if s.reportUrl and a.report_url != s.reportUrl:
                    a.report_url = s.reportUrl
                    updated = True

                # Sync cheat probability based on proctoring logs
                from app.models.ai_integration import ProctoringLog
                p_logs = db.query(ProctoringLog).filter(ProctoringLog.sessionId == s.id).all()
                critical_count = sum(1 for log in p_logs if log.severity in [Severity.CRITICAL, Severity.HIGH])
                med_count = sum(1 for log in p_logs if log.severity == Severity.MEDIUM)

                new_cheat = CheatProbability.low
                if critical_count > 0:
                    new_cheat = CheatProbability.high
                elif med_count > 0:
                    new_cheat = CheatProbability.medium

                if a.cheat_probability != new_cheat:
                    a.cheat_probability = new_cheat
                    updated = True

                # Sync attempted_at/completed_at
                completed_at = s.completedAt or s.updatedAt
                if completed_at and a.attempted_at != completed_at:
                    a.attempted_at = completed_at
                    updated = True

            if updated:
                db.add(a)

    if applicants:
        db.commit()

    return [
        {
            "id": str(a.id),
            "name": a.name,
            "email": a.email,
            "phone": a.phone,
            "source": a.source,
            "job_id": str(a.job_id),
            "screening_status": a.screening_status,
            "screening_score": a.screening_score,
            "functional_status": a.functional_status,
            "functional_score": a.functional_score,
            "cheat_probability": a.cheat_probability,
            "recruiter_screening": a.recruiter_screening,
            "recruiter_screening_score": a.recruiter_screening_score,
            "attempted_at": a.attempted_at.isoformat() if a.attempted_at else None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "resume_url": a.resume_url,
            "resume_analysed": a.resume_analysed,
            "match_score": a.match_score,
            "resume_analysis_report": a.resume_analysis_report,
        }
        for a in applicants
    ]
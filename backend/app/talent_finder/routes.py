"""Talent Finder API — mounted at /api/talent-finder. Org-scoped + audited.

Compliance: restricted sources are refused with a clear message; outreach is only
ever created as a DRAFT (recruiter must approve); opt-out is honored; admins can
delete candidate data.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.job import Job
from app.utils.auth import get_current_user, get_active_org_id

from . import models as M
from . import service as S
from .adapters import list_sources, AdapterContext
from .outreach import generate_outreach

router = APIRouter()


def _serialize_profile(p: M.CandidateProfile, sources: Optional[List[M.CandidateSource]] = None) -> Dict[str, Any]:
    return {
        "id": str(p.id), "full_name": p.full_name, "current_title": p.current_title,
        "current_company": p.current_company, "location": p.location, "email": p.email, "phone": p.phone,
        "profile_url": p.profile_url, "source_name": p.source_name, "source_type": p.source_type,
        "source_permission_status": p.source_permission_status, "skills": p.skills or [],
        "years_of_experience": p.years_of_experience, "education": p.education or [],
        "previous_companies": p.previous_companies or [], "resume_url": p.resume_url,
        "portfolio_url": p.portfolio_url, "github_url": p.github_url, "linkedin_url": p.linkedin_url,
        "availability_status": p.availability_status, "salary_expectation": p.salary_expectation,
        "notice_period": p.notice_period, "consent_status": p.consent_status,
        "outreach_status": p.outreach_status, "fit_score": p.fit_score, "fit_breakdown": p.fit_breakdown or {},
        "fit_reasoning": p.fit_reasoning, "risk_flags": p.risk_flags or [], "completeness": p.completeness,
        "sources": [{"source_name": s.source_name, "source_type": s.source_type,
                     "source_permission_status": s.source_permission_status, "profile_url": s.profile_url}
                    for s in (sources or [])],
    }


def _get_search(db, search_id, org_id) -> M.TalentSearch:
    s = db.query(M.TalentSearch).filter(M.TalentSearch.id == search_id).first()
    if not s or (org_id and s.organisation_id and s.organisation_id != org_id):
        raise HTTPException(status_code=404, detail="Search not found")
    return s


def _get_candidate(db, candidate_id, org_id) -> M.CandidateProfile:
    c = db.query(M.CandidateProfile).filter(M.CandidateProfile.id == candidate_id).first()
    if not c or (org_id and c.organisation_id and c.organisation_id != org_id):
        raise HTTPException(status_code=404, detail="Candidate not found")
    return c


# 0) Auto-extract a search brief from a job (JD + blueprint) --------------------
@router.post("/extract-brief")
def extract_brief_route(body: dict, current_user: User = Depends(get_current_user),
                        org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    job = None
    if body.get("jobRoleId"):
        job = db.query(Job).filter(Job.id == body["jobRoleId"]).first()
    brief = S.extract_brief(job, body.get("jdText"))
    return {"ok": True, "brief": {
        "title": brief["title"], "location": brief["location"],
        "experienceMin": brief["experience_min"], "experienceMax": brief["experience_max"],
        "mustHaveSkills": brief["must_have_skills"], "goodToHaveSkills": brief["good_to_have_skills"],
        "jdText": brief["jd_text"],
    }}


# 1) Run a search ---------------------------------------------------------------
@router.post("/search")
def create_search(body: dict, current_user: User = Depends(get_current_user),
                  org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    job = None
    job_id = body.get("jobRoleId")
    if job_id:
        job = db.query(Job).filter(Job.id == job_id).first()
    brief = S.build_brief(job, body)
    sources = S._selected_sources(body)

    search = M.TalentSearch(
        job_id=(job.id if job else None), organisation_id=org_id, created_by_id=current_user.id,
        status=M.SearchStatus.pending.value, brief=brief, sources=sources,
        max_candidates=int(body.get("maxCandidates") or 50),
    )
    db.add(search)
    db.commit()
    db.refresh(search)

    payload = {"csv_rows": body.get("csvRows") or [], "manual_profiles": body.get("manualProfiles") or [],
               "config": body.get("sourceConfig") or {}}
    try:
        summary = S.run_search(db, search, brief, payload)
    except Exception as e:  # noqa
        search.status = M.SearchStatus.failed.value
        search.error = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")

    S.audit(db, org_id, current_user.id, "search.run", "talent_search", search.id,
            {"sources": sources, "found": summary["found"], "ranked": summary["ranked"]})
    return {"searchId": str(search.id), "status": search.status, **summary}


# 2) Status ---------------------------------------------------------------------
@router.get("/search/{search_id}/status")
def search_status(search_id: UUID, current_user: User = Depends(get_current_user),
                  org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    s = _get_search(db, search_id, org_id)
    return {"searchId": str(s.id), "status": s.status, "found": s.found_count,
            "deduped": s.deduped_count, "ranked": s.ranked_count, "error": s.error,
            "source_notes": (s.brief or {}).get("_source_notes", {})}


# 3) Results --------------------------------------------------------------------
@router.get("/search/{search_id}/results")
def search_results(search_id: UUID, current_user: User = Depends(get_current_user),
                   org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    s = _get_search(db, search_id, org_id)
    rows = (db.query(M.TalentSearchResult)
            .filter(M.TalentSearchResult.search_id == s.id)
            .order_by(M.TalentSearchResult.fit_score.desc()).all())
    out = []
    for r in rows:
        p = db.query(M.CandidateProfile).filter(M.CandidateProfile.id == r.candidate_id).first()
        if not p:
            continue
        srcs = db.query(M.CandidateSource).filter(M.CandidateSource.candidate_id == p.id).all()
        out.append({**_serialize_profile(p, srcs), "rank": r.rank, "result_status": r.status,
                    "result_id": str(r.id)})
    return {"searchId": str(s.id), "count": len(out), "brief": s.brief, "results": out}


# 4/5) Shortlist / reject -------------------------------------------------------
def _set_result_status(db, candidate_id, org_id, status: str):
    c = _get_candidate(db, candidate_id, org_id)
    rows = db.query(M.TalentSearchResult).filter(M.TalentSearchResult.candidate_id == c.id).all()
    for r in rows:
        r.status = status
    db.commit()
    return c


@router.post("/candidates/{candidate_id}/shortlist")
def shortlist(candidate_id: UUID, current_user: User = Depends(get_current_user),
              org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    _set_result_status(db, candidate_id, org_id, M.ResultStatus.shortlisted.value)
    S.audit(db, org_id, current_user.id, "candidate.shortlist", "candidate_profile", candidate_id)
    return {"ok": True, "status": "shortlisted"}


@router.post("/candidates/{candidate_id}/reject")
def reject(candidate_id: UUID, current_user: User = Depends(get_current_user),
           org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    _set_result_status(db, candidate_id, org_id, M.ResultStatus.rejected.value)
    S.audit(db, org_id, current_user.id, "candidate.reject", "candidate_profile", candidate_id)
    return {"ok": True, "status": "rejected"}


# 6) Generate outreach (DRAFT only) --------------------------------------------
@router.post("/candidates/{candidate_id}/generate-outreach")
def gen_outreach(candidate_id: UUID, body: dict = None, current_user: User = Depends(get_current_user),
                 org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    c = _get_candidate(db, candidate_id, org_id)
    if c.outreach_status == M.OutreachStatus.opted_out.value:
        raise HTTPException(status_code=409, detail="Candidate has opted out of outreach.")
    company = "our team"
    if org_id:
        from app.models.organisation import Organisation
        org = db.query(Organisation).filter(Organisation.id == org_id).first()
        if org and org.org_name:
            company = org.org_name
    cand = _serialize_profile(c)
    brief = (body or {}).get("brief") or c.fit_breakdown or {}
    msg = generate_outreach(cand, brief, c.fit_breakdown or {}, company)
    row = M.CandidateOutreachMessage(candidate_id=c.id, channel=(body or {}).get("channel", "email"),
                                     message=msg, status=M.OutreachStatus.draft.value)
    db.add(row)
    c.outreach_status = M.OutreachStatus.draft.value
    db.commit()
    db.refresh(row)
    S.audit(db, org_id, current_user.id, "outreach.generate", "candidate_profile", candidate_id)
    return {"ok": True, "outreachId": str(row.id), "message": msg, "status": "draft",
            "note": "Draft only — recruiter must approve before sending."}


# 7) CSV import -----------------------------------------------------------------
@router.post("/import/csv")
async def import_csv(file: UploadFile = File(...), current_user: User = Depends(get_current_user),
                     org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    content = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    rows: List[Dict[str, Any]] = []
    skipped = 0
    for r in reader:
        row = {(k or "").strip().lower().replace(" ", "_"): (v or "").strip() for k, v in r.items()}
        if row.get("full_name") or row.get("name") or row.get("email"):
            rows.append(row)
        else:
            skipped += 1
    batch = M.CandidateImportBatch(
        organisation_id=org_id, created_by_id=current_user.id, source_type="uploaded_csv",
        filename=file.filename, row_count=len(rows) + skipped, imported_count=len(rows), skipped_count=skipped,
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    S.audit(db, org_id, current_user.id, "import.csv", "import_batch", batch.id,
            {"filename": file.filename, "rows": len(rows), "skipped": skipped})
    return {"ok": True, "batchId": str(batch.id), "rows": rows, "imported": len(rows), "skipped": skipped}


# 8) Configure sources (admin) --------------------------------------------------
@router.post("/sources/configure")
def configure_source(body: dict, current_user: User = Depends(get_current_user),
                     org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    stype = body.get("source_type")
    if not stype:
        raise HTTPException(status_code=400, detail="source_type required")
    cfg = (db.query(M.SourceAdapterConfig)
           .filter(M.SourceAdapterConfig.organisation_id == org_id, M.SourceAdapterConfig.source_type == stype)
           .first())
    if not cfg:
        cfg = M.SourceAdapterConfig(organisation_id=org_id, source_type=stype, source_name=body.get("source_name") or stype)
        db.add(cfg)
    cfg.is_enabled = bool(body.get("is_enabled", cfg.is_enabled))
    cfg.permission_mode = body.get("permission_mode", cfg.permission_mode)
    if body.get("config") is not None:
        cfg.config = body["config"]
    db.commit()
    S.audit(db, org_id, current_user.id, "sources.configure", "source_config", stype, {"is_enabled": cfg.is_enabled})
    return {"ok": True, "source_type": stype, "is_enabled": cfg.is_enabled}


@router.get("/sources")
def get_sources(current_user: User = Depends(get_current_user),
                org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    return {"sources": list_sources(AdapterContext(db=db, organisation_id=org_id, user_id=current_user.id))}


# Extras: opt-out, move-to-pipeline, admin delete -------------------------------
@router.post("/candidates/{candidate_id}/opt-out")
def opt_out(candidate_id: UUID, current_user: User = Depends(get_current_user),
            org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    c = _get_candidate(db, candidate_id, org_id)
    c.outreach_status = M.OutreachStatus.opted_out.value
    c.consent_status = "opted_out"
    db.commit()
    S.audit(db, org_id, current_user.id, "candidate.opt_out", "candidate_profile", candidate_id)
    return {"ok": True, "status": "opted_out"}


@router.post("/candidates/{candidate_id}/move-to-pipeline")
def move_to_pipeline(candidate_id: UUID, body: dict = None, current_user: User = Depends(get_current_user),
                     org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    """Move a shortlisted sourced candidate into the existing interview pipeline by
    creating an Applicant on the target job (then the normal schedule/interview flow applies)."""
    c = _get_candidate(db, candidate_id, org_id)
    job_id = (body or {}).get("jobId")
    if not job_id:
        s = (db.query(M.TalentSearchResult).filter(M.TalentSearchResult.candidate_id == c.id).first())
        if s:
            srch = db.query(M.TalentSearch).filter(M.TalentSearch.id == s.search_id).first()
            job_id = str(srch.job_id) if srch and srch.job_id else None
    if not job_id:
        raise HTTPException(status_code=400, detail="jobId required to move into the interview pipeline.")
    if not c.email:
        raise HTTPException(status_code=400, detail="Candidate has no email (needs a permissioned source) to invite.")
    from app.models.applicant import Applicant, ApplicantSource
    applicant = Applicant(name=c.full_name, email=c.email, phone=c.phone, job_id=job_id,
                          source=ApplicantSource.scheduled if hasattr(ApplicantSource, "scheduled") else None,
                          resume_url=c.resume_url, resume_text=(c.raw_source_payload or {}).get("resume_text"))
    db.add(applicant)
    for r in db.query(M.TalentSearchResult).filter(M.TalentSearchResult.candidate_id == c.id).all():
        r.status = M.ResultStatus.invited.value
    db.commit()
    db.refresh(applicant)
    S.audit(db, org_id, current_user.id, "candidate.move_to_pipeline", "candidate_profile", candidate_id,
            {"applicant_id": str(applicant.id), "job_id": str(job_id)})
    return {"ok": True, "applicantId": str(applicant.id), "jobId": str(job_id)}


@router.delete("/candidates/{candidate_id}")
def delete_candidate(candidate_id: UUID, current_user: User = Depends(get_current_user),
                     org_id: Optional[UUID] = Depends(get_active_org_id), db: Session = Depends(get_db)):
    """Privacy: hard-delete a candidate's sourced data (cascades sources/scores/results)."""
    c = _get_candidate(db, candidate_id, org_id)
    db.delete(c)
    db.commit()
    S.audit(db, org_id, current_user.id, "data.delete", "candidate_profile", candidate_id)
    return {"ok": True, "deleted": str(candidate_id)}

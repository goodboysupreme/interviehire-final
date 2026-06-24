"""Talent Finder orchestration: brief → adapters → normalize → dedup → hard
filters → weighted fit scoring → persistence. Runs synchronously (fast: internal
DB + provided data + deterministic scoring); the status endpoint reflects state.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from .adapters import build_adapters, AdapterContext
from .dedup import deduplicate
from .matching import compute_fit, hard_filters
from . import models as M


def _parse_band(band: Optional[str]):
    if not band:
        return (None, None)
    nums = re.findall(r"\d+(?:\.\d+)?", str(band))
    if len(nums) >= 2:
        return (float(nums[0]), float(nums[1]))
    if len(nums) == 1:
        return (float(nums[0]), None)
    return (None, None)


def build_brief(job, body: Dict[str, Any]) -> Dict[str, Any]:
    """Merge the job role with the recruiter's search request into one brief."""
    lo, hi = _parse_band(getattr(job, "experience_band", None)) if job else (None, None)
    exp = body.get("experienceRange") or {}
    brief = {
        "title": (getattr(job, "role_name", None) or getattr(job, "title", None)) if job else body.get("title"),
        "location": body.get("location") or (getattr(job, "location", None) if job else None),
        "remote_or_onsite": body.get("remoteOrOnsite") or (getattr(job, "job_type", None) if job else None),
        "experience_min": exp.get("min", lo),
        "experience_max": exp.get("max", hi),
        "must_have_skills": body.get("mustHaveSkills") or [],
        "good_to_have_skills": body.get("goodToHaveSkills") or [],
        "should_not_have": body.get("shouldNotHave") or [],
        "exclude_keywords": body.get("excludeKeywords") or [],
        "education_requirement": body.get("educationRequirement"),
        "industry_preference": body.get("industryPreference"),
        "jd_text": (getattr(job, "description", None) if job else None) or body.get("jdText") or "",
        "require_available": body.get("requireAvailable", False),
        # international students / global reach
        "include_international": bool(body.get("includeInternational", False)),
        "student_focus": bool(body.get("studentFocus", False)),
        "target_countries": [str(c).strip() for c in (body.get("targetCountries") or []) if str(c).strip()],
        "_web_cap": int(body.get("maxCandidates") or 50),
    }
    return brief


def extract_brief(job, jd_text: Optional[str] = None) -> Dict[str, Any]:
    """Auto-derive a search brief from a job role: must-haves from the authored
    blueprint (functional_parameters topics), good-to-haves from JD skill extraction,
    plus title/location/experience. Deterministic + keyless."""
    import json
    from .adapters.internal import COMMON_SKILLS, _extract_skills

    must: List[str] = []
    fp = getattr(job, "functional_parameters", None) if job else None
    if fp:
        try:
            data = json.loads(fp) if isinstance(fp, str) else fp
            topics = data.get("topics", []) if isinstance(data, dict) else []
            for t in topics:
                nm = (t or {}).get("name")
                if nm and nm not in must:
                    must.append(nm)
        except Exception:
            pass

    jd = jd_text or (getattr(job, "description", None) if job else "") or ""
    extracted = _extract_skills(jd, [])
    # If the blueprint gave no topics, seed must-haves from the strongest JD skills.
    if not must:
        must = extracted[:6]
    good = [s for s in extracted if s not in [m.lower() for m in must]][:8]

    lo, hi = _parse_band(getattr(job, "experience_band", None)) if job else (None, None)
    return {
        "title": (getattr(job, "role_name", None) or getattr(job, "title", None)) if job else None,
        "location": getattr(job, "location", None) if job else None,
        "experience_min": lo, "experience_max": hi,
        "must_have_skills": must, "good_to_have_skills": good,
        "jd_text": jd,
    }


def _selected_sources(body: Dict[str, Any]) -> List[str]:
    if body.get("sources"):
        return list(body["sources"])
    s = []
    if body.get("includeInternalDatabase", True):
        s += ["internal_db", "resume_db"]
    if body.get("includeUploadedFiles"):
        s += ["uploaded_csv", "manual_import"]
    if body.get("includePublicWeb"):
        s.append("public_web")
    if body.get("includeApprovedAPIs"):
        s.append("approved_api")
    return s or ["internal_db", "resume_db"]


def _upsert_profile(db: Session, org_id, cand: Dict[str, Any], fit: Dict[str, Any]) -> M.CandidateProfile:
    dk = cand.get("dedup_key")
    prof = None
    if dk:
        prof = (db.query(M.CandidateProfile)
                .filter(M.CandidateProfile.organisation_id == org_id, M.CandidateProfile.dedup_key == dk)
                .first())
    fields = dict(
        full_name=cand.get("full_name") or "Unknown",
        current_title=cand.get("current_title"),
        current_company=cand.get("current_company"),
        location=cand.get("location"),
        email=cand.get("email"),
        phone=cand.get("phone"),
        profile_url=cand.get("profile_url"),
        source_name=cand.get("source_name"),
        source_type=cand.get("source_type"),
        source_permission_status=cand.get("source_permission_status"),
        skills=cand.get("skills") or [],
        years_of_experience=cand.get("years_of_experience"),
        education=cand.get("education") or [],
        previous_companies=cand.get("previous_companies") or [],
        resume_url=cand.get("resume_url"),
        portfolio_url=cand.get("portfolio_url"),
        github_url=cand.get("github_url"),
        linkedin_url=cand.get("linkedin_url"),
        availability_status=cand.get("availability_status"),
        salary_expectation=cand.get("salary_expectation"),
        notice_period=cand.get("notice_period"),
        raw_source_payload=cand.get("raw_source_payload") or {},
        consent_status=cand.get("consent_status") or "unknown",
        dedup_key=dk,
        completeness=fit.get("completeness", 0.0),
        fit_score=fit.get("totalScore"),
        fit_breakdown=fit,
        fit_reasoning=fit.get("reasoning"),
        risk_flags=fit.get("riskFlags") or [],
    )
    if prof:
        for k, v in fields.items():
            setattr(prof, k, v)
    else:
        prof = M.CandidateProfile(organisation_id=org_id, **fields)
        db.add(prof)
    db.flush()
    return prof


def run_search(db: Session, search: M.TalentSearch, brief: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    org_id = search.organisation_id
    ctx = AdapterContext(db=db, organisation_id=org_id, user_id=search.created_by_id, payload=payload or {})

    # 1) discover from each selected source
    search.status = M.SearchStatus.searching.value
    db.commit()
    raw: List[Dict[str, Any]] = []
    source_notes: Dict[str, str] = {}
    for adapter in build_adapters(search.sources, ctx):
        cands, note = adapter.run(brief)
        source_notes[adapter.source_type] = note
        raw.extend(cands)
    search.found_count = len(raw)

    # 2) normalize already done by adapters; dedup across sources
    search.status = M.SearchStatus.deduping.value
    db.commit()
    deduped = deduplicate(raw)
    search.deduped_count = len(deduped)

    # 3) hard filters + weighted scoring + persist
    search.status = M.SearchStatus.ranking.value
    db.commit()
    scored: List[Dict[str, Any]] = []
    for cand in deduped:
        passed, fails = hard_filters(cand, brief)
        fit = compute_fit(cand, brief)
        if not passed:
            fit["riskFlags"] = (fit.get("riskFlags") or []) + [f"hard-filter: {f}" for f in fails]
            fit["totalScore"] = round(fit["totalScore"] * 0.5, 1)  # demote but keep visible
        prof = _upsert_profile(db, org_id, cand, fit)
        # preserve every source
        for s in (cand.get("_sources") or []):
            db.add(M.CandidateSource(
                candidate_id=prof.id, source_name=s.get("source_name"), source_type=s.get("source_type"),
                source_permission_status=s.get("source_permission_status"), profile_url=s.get("profile_url"),
                raw_payload=s.get("raw_payload") or {},
            ))
        db.add(M.CandidateFitScore(
            candidate_id=prof.id, search_id=search.id,
            total_score=fit["totalScore"], must_have_score=fit["mustHaveScore"],
            experience_score=fit["experienceScore"], semantic_score=fit["semanticScore"],
            location_score=fit["locationScore"], good_to_have_score=fit["goodToHaveScore"],
            risk_penalty=fit["riskPenalty"], matched_must_haves=fit["matchedMustHaves"],
            missing_must_haves=fit["missingMustHaves"], matched_good_to_haves=fit["matchedGoodToHaves"],
            reasoning=fit["reasoning"], recommendation=fit["recommendation"],
        ))
        scored.append({"profile": prof, "fit": fit, "passed": passed})

    # 4) rank, create result rows
    scored.sort(key=lambda x: x["fit"]["totalScore"], reverse=True)
    scored = scored[: max(1, search.max_candidates)]
    for i, s in enumerate(scored):
        db.add(M.TalentSearchResult(
            search_id=search.id, candidate_id=s["profile"].id,
            fit_score=s["fit"]["totalScore"], rank=i + 1, status=M.ResultStatus.new.value,
        ))
    search.ranked_count = len(scored)
    search.status = M.SearchStatus.done.value
    search.completed_at = datetime.now(timezone.utc)
    brief = dict(brief)
    brief["_source_notes"] = source_notes
    search.brief = brief
    db.commit()

    return {
        "found": search.found_count, "deduped": search.deduped_count,
        "ranked": search.ranked_count, "source_notes": source_notes,
        "no_results_hint": (None if scored else
                            "No candidates found. Try broadening location, reducing must-have filters, "
                            "or importing a candidate list (CSV / pasted profiles)."),
    }


def audit(db: Session, org_id, user_id, action: str, entity_type=None, entity_id=None, detail=None):
    try:
        db.add(M.TalentFinderAuditLog(
            organisation_id=org_id, user_id=user_id, action=action,
            entity_type=entity_type, entity_id=str(entity_id) if entity_id else None, detail=detail or {},
        ))
        db.commit()
    except Exception:
        db.rollback()

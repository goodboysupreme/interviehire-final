"""Hybrid candidate matching engine — PURE functions (no DB, no network) so the
scoring/explainability/bias logic is deterministically unit-testable.

Pipeline: hard filters → semantic-lite similarity → weighted scoring →
explainability → bias check. Embeddings are abstracted behind `semantic_score`;
today it uses a deterministic token+synonym overlap (keyless), and there's a
clear hook to swap in a real embedding provider later.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

# Weighted scoring (sums to 1.0). Mirrors the product spec.
WEIGHTS = {
    "must_have": 0.40,
    "experience": 0.20,
    "title": 0.15,       # role/title similarity (semantic)
    "industry": 0.10,    # industry/company relevance
    "location": 0.10,    # location / availability
    "good_to_have": 0.05,
}

# Light skill-synonym map so "js" ↔ "javascript", "ml" ↔ "machine learning", etc.
SKILL_SYNONYMS = {
    "js": "javascript", "ts": "typescript", "py": "python", "ml": "machine learning",
    "ai": "artificial intelligence", "nlp": "natural language processing",
    "k8s": "kubernetes", "gcp": "google cloud", "aws": "amazon web services",
    "pm": "product management", "saas": "software as a service", "crm": "customer relationship management",
    "reactjs": "react", "nodejs": "node", "node.js": "node", "react.js": "react",
    "postgres": "postgresql", "psql": "postgresql", "golang": "go",
    "b2b": "business to business", "b2c": "business to consumer",
}

# Sensitive attributes we must NEVER score on, and must flag if a brief tries to.
SENSITIVE_TERMS = [
    "gender", "male", "female", "caste", "religion", "hindu", "muslim", "christian",
    "age", "young", "old", "ethnicity", "race", "disability", "disabled",
    "political", "married", "unmarried", "pregnan", "nationality",
]


def _norm(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def _canon_skill(s: str) -> str:
    s = _norm(s)
    return SKILL_SYNONYMS.get(s, s)


def _tokenize(text: Any) -> List[str]:
    return [t for t in re.split(r"[^a-z0-9+#.]+", _norm(text)) if len(t) > 1]


def _skill_set(skills: Any) -> set:
    if isinstance(skills, str):
        skills = re.split(r"[,;|]", skills)
    return {_canon_skill(s) for s in (skills or []) if _norm(s)}


def match_skills(candidate_skills: Any, required: Any) -> Tuple[List[str], List[str]]:
    """Return (matched, missing) using canonical + substring (synonym-aware) match."""
    cand = _skill_set(candidate_skills)
    cand_blob = " ".join(cand)
    matched, missing = [], []
    for req in (required or []):
        rc = _canon_skill(req)
        if not rc:
            continue
        hit = rc in cand or any(rc in c or c in rc for c in cand) or rc in cand_blob
        (matched if hit else missing).append(req)
    return matched, missing


def semantic_score(jd_text: str, candidate_text: str) -> float:
    """Deterministic semantic-lite similarity in [0,1] (token+synonym overlap,
    length-normalized). HOOK: replace with cosine over real embeddings later —
    e.g. embed(jd_text) · embed(candidate_text)."""
    jd = {_canon_skill(t) for t in _tokenize(jd_text)}
    cand = {_canon_skill(t) for t in _tokenize(candidate_text)}
    if not jd or not cand:
        return 0.0
    inter = len(jd & cand)
    # Jaccard-ish but biased toward JD coverage (how much of the JD the candidate covers).
    return round(min(1.0, (inter / max(1, len(jd))) * 0.7 + (inter / len(jd | cand)) * 0.3), 4)


def title_similarity(candidate_title: str, role_title: str) -> float:
    a, b = set(_tokenize(candidate_title)), set(_tokenize(role_title))
    if not a or not b:
        return 0.0
    return round(len(a & b) / len(a | b), 4)


def _exp_score(years: Any, lo: Any, hi: Any) -> float:
    try:
        y = float(years)
    except (TypeError, ValueError):
        return 0.5  # unknown experience → neutral
    lo = float(lo) if lo not in (None, "") else 0.0
    hi = float(hi) if hi not in (None, "") else 1e9
    if lo <= y <= hi:
        return 1.0
    # graceful falloff outside the band
    gap = (lo - y) if y < lo else (y - hi)
    return round(max(0.0, 1.0 - gap / 4.0), 4)


def hard_filters(candidate: Dict[str, Any], brief: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Mandatory gates. Returns (passed, reasons_failed)."""
    fails: List[str] = []

    # Location (enforced when a location is given, unless the role is explicitly
    # remote/any, or the search is intentionally international/global)
    loc = _norm(brief.get("location"))
    remote = _norm(brief.get("remote_or_onsite")) in ("remote", "any")
    intl = bool(brief.get("include_international"))
    if loc and not remote and not intl:
        cloc = _norm(candidate.get("location"))
        if cloc and loc not in cloc and cloc not in loc:
            fails.append(f"location mismatch ({candidate.get('location')} vs {brief.get('location')})")

    # Experience range
    yrs = candidate.get("years_of_experience")
    lo, hi = brief.get("experience_min"), brief.get("experience_max")
    if yrs is not None and (lo not in (None, "") or hi not in (None, "")):
        try:
            y = float(yrs)
            if lo not in (None, "") and y < float(lo) - 0.5:
                fails.append(f"below min experience ({y} < {lo})")
            if hi not in (None, "") and y > float(hi) + 5:
                fails.append(f"far above max experience ({y} > {hi})")
        except (TypeError, ValueError):
            pass

    # Mandatory (must-have) skills — require at least majority present
    must = brief.get("must_have_skills") or []
    if must:
        matched, missing = match_skills(candidate.get("skills"), must)
        if len(matched) == 0:
            fails.append("no must-have skills matched")

    # Availability (if the brief requires actively available)
    if _norm(brief.get("require_available")) in ("true", "1", "yes"):
        if _norm(candidate.get("availability_status")) in ("not available", "unavailable", "passive"):
            fails.append("not available")

    # Exclusion keywords
    excl = [_norm(k) for k in (brief.get("exclude_keywords") or []) if _norm(k)]
    blob = _norm(" ".join([
        str(candidate.get("current_title") or ""), str(candidate.get("current_company") or ""),
        " ".join(candidate.get("skills") or []), str(candidate.get("location") or ""),
    ]))
    for k in excl:
        if k in blob:
            fails.append(f"matched exclusion keyword '{k}'")

    return (len(fails) == 0, fails)


def bias_check(brief: Dict[str, Any], candidate: Dict[str, Any]) -> List[str]:
    """Surface fairness risks. We NEVER score on sensitive attributes; if a brief
    references them, flag it so it can be reviewed/removed."""
    flags: List[str] = []
    brief_blob = _norm(" ".join(str(v) for v in [
        brief.get("jd_text"), " ".join(brief.get("exclude_keywords") or []),
        brief.get("notes"),
    ]))
    for term in SENSITIVE_TERMS:
        if term in brief_blob:
            flags.append(f"brief references a sensitive attribute ('{term}') — ignored in scoring; review for bias")
            break
    return flags


def candidate_completeness(candidate: Dict[str, Any]) -> float:
    fields = ["full_name", "current_title", "location", "skills", "years_of_experience",
              "email", "resume_url", "previous_companies", "education"]
    present = sum(1 for f in fields if candidate.get(f) not in (None, "", [], {}))
    return round(present / len(fields), 2)


def compute_fit(candidate: Dict[str, Any], brief: Dict[str, Any]) -> Dict[str, Any]:
    """Full weighted, explainable fit score in the spec's output format."""
    must = brief.get("must_have_skills") or []
    good = brief.get("good_to_have_skills") or []

    matched_must, missing_must = match_skills(candidate.get("skills"), must)
    matched_good, _ = match_skills(candidate.get("skills"), good)

    must_have_score = (len(matched_must) / len(must)) if must else 1.0
    good_to_have_score = (len(matched_good) / len(good)) if good else 1.0
    experience_score = _exp_score(candidate.get("years_of_experience"),
                                  brief.get("experience_min"), brief.get("experience_max"))
    cand_text = " ".join(str(x) for x in [
        candidate.get("current_title"), candidate.get("current_company"),
        " ".join(candidate.get("skills") or []), " ".join(candidate.get("previous_companies") or []),
        candidate.get("location"), candidate.get("resume_text") or "",
    ])
    sem = semantic_score(brief.get("jd_text") or " ".join(must + good), cand_text)
    title = title_similarity(candidate.get("current_title"), brief.get("title"))
    # industry/company relevance — overlap of previous companies / industry keywords with JD
    industry = semantic_score(
        " ".join([str(brief.get("industry_preference") or ""), brief.get("title") or ""]),
        " ".join([str(candidate.get("current_company") or "")] + (candidate.get("previous_companies") or [])),
    )
    # location/availability
    loc_ok = 1.0
    if _norm(brief.get("location")) and _norm(candidate.get("location")):
        loc_ok = 1.0 if _norm(brief.get("location")) in _norm(candidate.get("location")) else 0.3
    avail = 0.5 if _norm(candidate.get("availability_status")) in ("", "unknown") else (
        1.0 if _norm(candidate.get("availability_status")) in ("available", "active", "open") else 0.4)
    location_score = round((loc_ok + avail) / 2, 4)

    # title weight blends explicit title sim + semantic (so adjacent paths still score)
    title_blend = round(0.6 * max(title, sem) + 0.4 * sem, 4)

    risk_flags = bias_check(brief, candidate)
    completeness = candidate_completeness(candidate)
    if completeness < 0.4:
        risk_flags.append(f"low profile completeness ({int(completeness*100)}%)")
    if candidate.get("source_permission_status") == "requires_permission":
        risk_flags.append("source requires permission — verify before outreach")
    risk_penalty = round(min(0.15, 0.05 * len(risk_flags)), 4)

    total = (
        WEIGHTS["must_have"] * must_have_score
        + WEIGHTS["experience"] * experience_score
        + WEIGHTS["title"] * title_blend
        + WEIGHTS["industry"] * industry
        + WEIGHTS["location"] * location_score
        + WEIGHTS["good_to_have"] * good_to_have_score
    ) - risk_penalty
    total = max(0.0, min(1.0, total))
    total_100 = round(total * 100, 1)

    recommendation = (
        "strong_fit" if total_100 >= 75 else
        "good_fit" if total_100 >= 55 else
        "consider" if total_100 >= 40 else "weak_fit"
    )
    reasoning = _build_reasoning(candidate, brief, matched_must, missing_must, matched_good, total_100)

    return {
        "candidateId": candidate.get("id"),
        "totalScore": total_100,
        "mustHaveScore": round(must_have_score * 100, 1),
        "experienceScore": round(experience_score * 100, 1),
        "semanticScore": round(title_blend * 100, 1),
        "locationScore": round(location_score * 100, 1),
        "goodToHaveScore": round(good_to_have_score * 100, 1),
        "riskPenalty": round(risk_penalty * 100, 1),
        "matchedMustHaves": matched_must,
        "missingMustHaves": missing_must,
        "matchedGoodToHaves": matched_good,
        "riskFlags": risk_flags,
        "completeness": completeness,
        "reasoning": reasoning,
        "recommendation": recommendation,
    }


def _build_reasoning(candidate, brief, matched_must, missing_must, matched_good, score) -> str:
    must = brief.get("must_have_skills") or []
    parts = []
    label = {"strong_fit": "Strong fit", "good_fit": "Good fit"}.get(
        "strong_fit" if score >= 75 else "good_fit" if score >= 55 else "x", "Possible fit")
    yrs = candidate.get("years_of_experience")
    if yrs is not None:
        parts.append(f"{yrs}+ yrs experience")
    if candidate.get("current_title"):
        parts.append(f"as {candidate.get('current_title')}")
    head = f"{label}: candidate " + (", ".join(parts) if parts else "profile reviewed")
    if must:
        head += f". Matches {len(matched_must)}/{len(must)} must-have skills"
        if matched_must:
            head += f" ({', '.join(matched_must[:5])})"
    if matched_good:
        head += f". Also has good-to-have: {', '.join(matched_good[:4])}"
    if missing_must:
        head += f". Missing: {', '.join(missing_must[:4])} — assess transferability"
    return head + "."

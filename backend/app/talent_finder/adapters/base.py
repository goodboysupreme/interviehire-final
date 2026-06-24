"""SourceAdapter base interface — every source plugs in through this contract so
new (approved) sources can be added without touching the engine.

COMPLIANCE: an adapter must declare its `permission_mode` and pass
`validate_permissions()` before it runs. Adapters for restricted platforms ship
DISABLED and return a clear "requires API access / written permission / user
export" error — never a stealth scrape.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple


@dataclass
class AdapterContext:
    """Everything an adapter might need, supplied by the service per-search."""
    db: Any = None
    organisation_id: Any = None
    user_id: Any = None
    payload: Dict[str, Any] = field(default_factory=dict)   # CSV rows, pasted URLs, API cfg, …


class SourceAdapter:
    source_name: str = "base"
    source_type: str = "base"
    permission_mode: str = "requires_permission"   # permissioned | public_allowed | user_provided | requires_permission
    is_enabled: bool = False
    rate_limit_config: Dict[str, Any] = {"max_per_minute": 30, "concurrency": 1}

    def __init__(self, ctx: AdapterContext):
        self.ctx = ctx

    # --- compliance gate -----------------------------------------------------
    def validate_permissions(self) -> Tuple[bool, str]:
        """Return (ok, reason). Disabled / restricted adapters return False with a
        recruiter-facing explanation."""
        if not self.is_enabled:
            return (False, "This source requires API access, written permission, or user import.")
        return (True, "ok")

    # --- discovery -----------------------------------------------------------
    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Return a list of RAW source profiles for the brief. Adapters must obey
        rate limits / robots.txt and must never bypass auth/CAPTCHA."""
        return []

    def fetch_profile(self, profile_ref: Any) -> Dict[str, Any]:
        return {}

    # --- normalization -------------------------------------------------------
    def normalize(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Map a raw source profile onto the standard CandidateProfile dict."""
        return normalize_common(raw, self.source_name, self.source_type, self.permission_mode)

    def error_handling(self, exc: Exception) -> Dict[str, Any]:
        return {"source": self.source_name, "error": str(exc)}

    def run(self, brief: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
        """search → normalize, guarded by permission validation. Returns
        (normalized_candidates, note). Never raises into the service."""
        ok, reason = self.validate_permissions()
        if not ok:
            return ([], reason)
        try:
            raw = self.search_candidates(brief) or []
            out = []
            for r in raw:
                try:
                    n = self.normalize(r)
                    if n.get("full_name"):
                        out.append(n)
                except Exception:
                    continue
            return (out, "ok")
        except Exception as exc:  # noqa
            return ([], f"{self.source_name} error: {exc}")


# Shared normalizer so every adapter emits the same CandidateProfile shape.
def _as_list(v: Any) -> List[str]:
    if v is None or v == "":
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    import re
    return [p.strip() for p in re.split(r"[,;|]", str(v)) if p.strip()]


def _as_float(v: Any):
    try:
        return float(str(v).strip().split()[0])
    except (TypeError, ValueError, IndexError):
        return None


def normalize_common(raw: Dict[str, Any], source_name: str, source_type: str, permission_mode: str) -> Dict[str, Any]:
    g = lambda *keys: next((raw[k] for k in keys if raw.get(k) not in (None, "")), None)  # noqa
    # Only carry email/phone when the source is permissioned/user-provided.
    contact_ok = permission_mode in ("permissioned", "user_provided")
    return {
        "full_name": g("full_name", "name", "fullName", "candidate_name") or "",
        "current_title": g("current_title", "title", "headline", "role"),
        "current_company": g("current_company", "company", "employer"),
        "location": g("location", "city", "region"),
        "email": (g("email") if contact_ok else None),
        "phone": (g("phone", "mobile") if contact_ok else None),
        "profile_url": g("profile_url", "url", "link"),
        "skills": _as_list(g("skills", "skill_set", "tags")),
        "years_of_experience": _as_float(g("years_of_experience", "experience", "yoe", "exp")),
        "education": _as_list(g("education", "degree")),
        "previous_companies": _as_list(g("previous_companies", "past_companies", "companies")),
        "resume_url": g("resume_url", "resume", "cv_url"),
        "portfolio_url": g("portfolio_url", "portfolio", "website"),
        "github_url": g("github_url", "github"),
        "linkedin_url": g("linkedin_url", "linkedin"),  # only ever set via compliant import
        "availability_status": g("availability_status", "availability", "status"),
        "salary_expectation": g("salary_expectation", "expected_salary", "ctc"),
        "notice_period": g("notice_period", "notice"),
        "resume_text": g("resume_text", "bio", "summary"),
        "source_name": source_name,
        "source_type": source_type,
        "source_permission_status": permission_mode,
        "consent_status": "permissioned" if contact_ok else "unknown",
        "raw_source_payload": raw,
    }

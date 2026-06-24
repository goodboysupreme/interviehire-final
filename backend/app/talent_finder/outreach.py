"""Personalized outreach generation.

Deterministic, on-brand template by default (works with zero API keys), with an
optional LLM rewrite when DEEPSEEK_API_KEY is configured. Messages are always
created as DRAFTS — a recruiter must explicitly approve before anything is sent.
Opt-out / consent is respected upstream (we never draft for opted-out candidates).
"""
from __future__ import annotations

from typing import Any, Dict

from app.config import settings


def _first_name(full_name: str) -> str:
    return (str(full_name or "there").strip().split() or ["there"])[0]


def build_template_message(candidate: Dict[str, Any], brief: Dict[str, Any], fit: Dict[str, Any],
                           company_name: str = "our team") -> str:
    name = _first_name(candidate.get("full_name"))
    role = brief.get("title") or "an open role"
    matched = fit.get("matchedMustHaves") or fit.get("matched_must_haves") or []
    relevance = (
        ", ".join(matched[:2]) if matched
        else (candidate.get("current_title") or candidate.get("current_company") or "your background")
    )
    domain = candidate.get("current_company") or (candidate.get("previous_companies") or ["your domain"])[0]
    return (
        f"Hi {name}, I came across your profile and noticed your experience in {relevance} "
        f"(including your work at {domain}). We're hiring for a {role} at {company_name} where your "
        f"background in {relevance} could be highly relevant. Would you be open to a quick AI-led "
        f"first-round interview this week? No prep needed — it's a short, flexible conversation."
    )


def _has_llm() -> bool:
    k = settings.DEEPSEEK_API_KEY
    return bool(k and k not in ("", "replace-me"))


def generate_outreach(candidate: Dict[str, Any], brief: Dict[str, Any], fit: Dict[str, Any],
                      company_name: str = "our team") -> str:
    """Return a draft outreach message. Tries the LLM for a warmer, tailored note;
    falls back to the deterministic template on any error / missing key."""
    base = build_template_message(candidate, brief, fit, company_name)
    if not _has_llm():
        return base
    try:
        import requests
        matched = ", ".join((fit.get("matchedMustHaves") or [])[:4])
        prompt = (
            "Write a concise, warm, professional recruiting outreach message (3-4 sentences, no subject line, "
            "no placeholders left unfilled). Personalize using the details. End with a CTA inviting them to a "
            "short AI-led first-round interview. Do NOT mention or infer any sensitive attributes.\n\n"
            f"Candidate first name: {_first_name(candidate.get('full_name'))}\n"
            f"Candidate current title: {candidate.get('current_title')}\n"
            f"Candidate company: {candidate.get('current_company')}\n"
            f"Matched skills: {matched}\n"
            f"Role: {brief.get('title')}\n"
            f"Company: {company_name}\n"
            f"Why relevant: {fit.get('reasoning')}\n"
        )
        resp = requests.post(
            settings.__dict__.get("DEEPSEEK_BASE_URL", None) or "https://api.deepseek.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": getattr(settings, "DEEPSEEK_MODEL", None) or "deepseek-chat",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.6, "max_tokens": 300,
            },
            timeout=25,
        )
        if resp.ok:
            txt = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
            if txt:
                return txt
    except Exception:
        pass
    return base

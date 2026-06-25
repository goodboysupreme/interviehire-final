from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.user_preferences import UserPreferences
from app.schemas import ChangePasswordIn
from app.utils.auth import get_current_user, get_password_hash, verify_password

router = APIRouter()


# ─── Password ────────────────────────────────────────────────────────────────

@router.put("/password")
def change_password(
    data: ChangePasswordIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Operate only on the authenticated caller — never a hardcoded account.
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Always require the current password (uses the same bcrypt scheme as login).
    if not user.hashed_password:
        raise HTTPException(
            status_code=400,
            detail="No password is set for this account; use account recovery instead.",
        )
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    user.hashed_password = get_password_hash(data.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


@router.post("/password")
def change_password_post(
    data: ChangePasswordIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return change_password(data, current_user, db)


# ─── User Preferences ────────────────────────────────────────────────────────

VALID_THEMES = {"dark", "light", "system"}


class PreferencesIn(BaseModel):
    theme: Optional[Literal["dark", "light", "system"]] = None


class PreferencesOut(BaseModel):
    theme: str

    class Config:
        from_attributes = True


def _get_or_create_prefs(user_id, db: Session) -> UserPreferences:
    """Fetch preferences row, creating a 'dark' default if it doesn't exist yet."""
    prefs = db.query(UserPreferences).filter(UserPreferences.user_id == user_id).first()
    if not prefs:
        prefs = UserPreferences(user_id=user_id, theme="dark")
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the signed-in user's saved preferences (theme etc.)."""
    prefs = _get_or_create_prefs(current_user.id, db)
    return PreferencesOut(theme=prefs.theme)


@router.put("/preferences", response_model=PreferencesOut)
def update_preferences(
    data: PreferencesIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the user's preference choices. Partial updates are safe — only
    provided fields are changed."""
    prefs = _get_or_create_prefs(current_user.id, db)

    if data.theme is not None:
        prefs.theme = data.theme

    db.commit()
    db.refresh(prefs)
    return PreferencesOut(theme=prefs.theme)


from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas import ChangePasswordIn
from app.utils.auth import get_current_user, get_password_hash, verify_password

router = APIRouter()


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

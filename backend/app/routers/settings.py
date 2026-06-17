from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas import ChangePasswordIn
 
router = APIRouter()
 
 
import hashlib

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


@router.put("/password")
def change_password(data: ChangePasswordIn, db: Session = Depends(get_db)):
    # Retrieve default admin user (Devasri)
    user = db.query(User).filter(User.email == "devasri@interviehire.ai").first()
    if not user:
        raise HTTPException(status_code=404, detail="Admin user not found")
    
    # Verify current password if one is set
    if user.hashed_password:
        current_hash = hash_password(data.current_password)
        if current_hash != user.hashed_password:
            raise HTTPException(status_code=400, detail="Current password is incorrect")
            
    # Update password
    user.hashed_password = hash_password(data.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


@router.post("/password")
def change_password_post(data: ChangePasswordIn, db: Session = Depends(get_db)):
    return change_password(data, db)
 
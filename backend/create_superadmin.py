"""Idempotently create the dedicated Superadmin account on the LIVE database.

Unlike seed.py (which wipes every table for a clean local seed), this script only
inserts the superadmin row if it is missing — safe to run against production data.

Usage (venv active, requirements installed):
    python create_superadmin.py
"""
import sys

from app.database import SessionLocal, Base, engine
from app.models.user import User, UserStatus, UserType
from app.utils.auth import get_password_hash

SUPERADMIN_EMAIL = "superadmin@interviehire.com"
SUPERADMIN_PASSWORD = "superadminpass"


def create_superadmin():
    # Make sure tables exist (no-op if they already do).
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == SUPERADMIN_EMAIL).first()
        if existing:
            print(f"Superadmin already exists ({SUPERADMIN_EMAIL}) — nothing to do.")
            return

        superadmin = User(
            name="Superadmin",
            email=SUPERADMIN_EMAIL,
            designation="Superadmin",
            user_type=UserType.super_admin,
            status=UserStatus.active,
            hashed_password=get_password_hash(SUPERADMIN_PASSWORD),
            organisation_id=None,
        )
        db.add(superadmin)
        db.commit()
        print(f"Created Superadmin account: {SUPERADMIN_EMAIL}")
        print("Recommend changing the password after first login.")
    except Exception as e:
        print(f"Error creating superadmin: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    create_superadmin()

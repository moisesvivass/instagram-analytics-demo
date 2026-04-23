from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.tracker import get_tracker_metrics

router = APIRouter(prefix="/api/tracker", tags=["tracker"])


@router.get("/metrics")
def tracker_metrics(db: Session = Depends(get_db)):
    try:
        return get_tracker_metrics(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to compute tracker metrics") from exc

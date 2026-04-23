from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.instagram import fetch_overview, fetch_posts, fetch_reach_chart

router = APIRouter(prefix="/api", tags=["refresh"])


@router.post("/refresh")
async def force_refresh(db: Session = Depends(get_db)):
    try:
        overview = await fetch_overview()
        posts = await fetch_posts(db=db)
        reach = await fetch_reach_chart()
        return {
            "status": "ok",
            "refreshed_at": datetime.utcnow().isoformat(),
            "posts_count": len(posts),
            "reach_days": len(reach),
            "followers": overview.get("followers"),
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Refresh failed") from exc

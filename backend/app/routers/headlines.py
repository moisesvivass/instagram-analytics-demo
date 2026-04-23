from fastapi import APIRouter, HTTPException

from app.services.headlines import fetch_headlines

router = APIRouter(prefix="/api", tags=["headlines"])


@router.get("/headlines")
async def headlines():
    try:
        return await fetch_headlines()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to fetch headlines") from exc

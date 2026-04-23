import os
from functools import lru_cache


REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "BASIC_AUTH_USER",
    "BASIC_AUTH_PASSWORD",
    "ALLOWED_ORIGIN",
    "ENVIRONMENT",
]

# These are only required when not using mock data
INSTAGRAM_ENV_VARS = [
    "INSTAGRAM_ACCESS_TOKEN",
    "INSTAGRAM_BUSINESS_ACCOUNT_ID",
]

# Required when AI insights are enabled (not mock)
AI_ENV_VARS = [
    "ANTHROPIC_API_KEY",
]


class Settings:
    database_url: str
    basic_auth_user: str
    basic_auth_password: str
    allowed_origin: str
    environment: str
    use_mock_data: bool
    instagram_access_token: str
    instagram_business_account_id: str
    anthropic_api_key: str

    def __init__(self) -> None:
        missing = [v for v in REQUIRED_ENV_VARS if not os.getenv(v)]
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}"
            )

        self.database_url = os.environ["DATABASE_URL"]
        self.basic_auth_user = os.environ["BASIC_AUTH_USER"]
        self.basic_auth_password = os.environ["BASIC_AUTH_PASSWORD"]
        self.allowed_origin = os.environ["ALLOWED_ORIGIN"]
        self.environment = os.environ["ENVIRONMENT"]
        self.use_mock_data = os.getenv("USE_MOCK_DATA", "true").lower() == "true"

        if not self.use_mock_data:
            missing_real = [v for v in INSTAGRAM_ENV_VARS + AI_ENV_VARS if not os.getenv(v)]
            if missing_real:
                raise RuntimeError(
                    f"USE_MOCK_DATA=false but missing: {', '.join(missing_real)}"
                )

        self.instagram_access_token = os.getenv("INSTAGRAM_ACCESS_TOKEN", "")
        self.instagram_business_account_id = os.getenv("INSTAGRAM_BUSINESS_ACCOUNT_ID", "")
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY", "")

        if self.environment not in ("development", "production"):
            raise RuntimeError(
                f"ENVIRONMENT must be 'development' or 'production', got: {self.environment!r}"
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

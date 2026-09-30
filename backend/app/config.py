from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Market data providers
    finnhub_api_key: str = ""
    twelvedata_api_key: str = ""
    # Free-tier request limits; raise them if you have a paid plan.
    finnhub_rate_per_min: int = 60
    twelvedata_rate_per_min: int = 8

    # Claude (the Anthropic SDK also reads ANTHROPIC_API_KEY from the environment)
    anthropic_api_key: str = ""
    claude_model: str = "claude-opus-5-5"
    claude_effort: str = "medium"

    # LangSmith tracing is configured via LANGSMITH_TRACING / LANGSMITH_API_KEY /
    # LANGSMITH_PROJECT env vars, which langsmith reads directly.

    cors_origins: list[str] = ["http://localhost:3000"]

    # Cost protection for AI analyses (0 disables a limit).
    analyze_limit_per_hour: int = 5  # per visitor IP
    analyze_limit_per_day: int = 100  # whole site
    analysis_cache_hours: float = 12  # repeat analyses of the same symbol/range are free

    # Big-move detection
    move_z_threshold: float = 2.0
    max_moves_to_explain: int = 6


@lru_cache
def get_settings() -> Settings:
    return Settings()

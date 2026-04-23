from slowapi import Limiter
from slowapi.util import get_remote_address

# No default_limits — avoids storing every IP that hits public endpoints in MemoryStorage.
# Per-endpoint limits on Claude-backed routes (10/hour, 20/hour) are defined via decorators.
limiter = Limiter(key_func=get_remote_address)

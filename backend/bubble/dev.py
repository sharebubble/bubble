import sys
from pathlib import Path

from uvicorn import run

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))


def main() -> None:
    run(
        "config.asgi:application",
        host="127.0.0.1",
        port=9000,
        reload=True,
    )

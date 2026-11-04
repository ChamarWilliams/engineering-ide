import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.pop("DATABASE_URL", None)
os.environ["EIDE_RUNS_PER_MIN"] = "100000"
os.environ["EIDE_TERMINAL"] = "off"
os.environ.pop("EIDE_PASSWORD", None)
os.environ.pop("EIDE_MULTIUSER", None)

PROJECT = ROOT / "samples" / "loopline-test-project"


@pytest.fixture(scope="session")
def client(tmp_path_factory):
    from fastapi.testclient import TestClient

    from backend import db
    from backend.main import app

    db.SQLITE_PATH = tmp_path_factory.mktemp("db") / "sessions.db"
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def tools():
    from backend import runner

    return runner.toolchain()


def read_sample(rel):
    return (PROJECT / rel).read_text(encoding="utf-8")


def normalize(text):
    return (text or "").replace("\r\n", "\n")

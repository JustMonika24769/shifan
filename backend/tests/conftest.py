import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATA_DIR"] = str(Path(__file__).resolve().parents[2] / ".test-data")
os.environ["ADMIN_PASSWORD"] = "test-only-password-12345"
os.environ["PUBLIC_ORIGIN"] = "http://testserver"
os.environ["COOKIE_SECURE"] = "false"
from cryptography.fernet import Fernet

os.environ["MASTER_KEY"] = Fernet.generate_key().decode()

import pytest
from fastapi.testclient import TestClient
from app.db import Base, engine, Session, Document
from app.main import app


@pytest.fixture
def client():
    Base.metadata.create_all(engine)
    with Session.begin() as db:
        db.query(Document).delete()
    with TestClient(app) as client:
        client.headers["origin"] = "http://testserver"
        yield client


@pytest.fixture
def authenticated(client):
    assert (
        client.post(
            "/api/v1/login", json={"password": os.environ["ADMIN_PASSWORD"]}
        ).status_code
        == 200
    )
    return client

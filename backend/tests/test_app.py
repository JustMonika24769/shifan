import io
import json
import zipfile

import pytest

from app.backup import archive, restore, snapshot
from app.db import get, put
from app.domain import validate_record


def sample():
    put("subjects", "subject-test", {"title": "葬送的芙莉莲"})
    watch = {
        "subject_id": "subject-test",
        "status": "completed",
        "finished": "2024-04",
        "precision": "month",
        "score": 9,
        "progress": 28,
        "tags": ["治愈"],
    }
    put("watches", "watch-test", watch)
    return watch


def test_auth_and_csrf(client):
    assert client.get("/api/v1/state").status_code == 401
    assert (
        client.post(
            "/api/v1/login",
            json={"password": "wrong"},
            headers={"origin": "https://evil.test"},
        ).status_code
        == 403
    )
    assert client.post("/api/v1/login", json={"password": "wrong"}).status_code == 401


def test_record_precision_rewatch_and_conflict(authenticated):
    c = authenticated
    w = sample()
    bad = c.put(
        "/api/v1/records/watches/watch-bad", json=w | {"finished": "2024-04-01"}
    )
    assert bad.status_code == 422
    assert (
        c.put(
            "/api/v1/records/watches/watch-rewatch",
            json=w | {"finished": "2026", "precision": "year"},
        ).status_code
        == 200
    )
    result = c.get("/api/v1/statistics").json()
    assert result["completions"] == 2 and result["unique"] == 1
    assert result["months"] == {"2024-04": 1}
    assert (
        c.put(
            "/api/v1/records/watches/watch-test", json=w | {"revision": 999}
        ).status_code
        == 422
    )
    assert (
        c.put(
            "/api/v1/records/notes/admin", json={"text": "overwrite auth"}
        ).status_code
        == 400
    )


def test_secret_masking_and_backup(authenticated):
    sample()
    c = authenticated
    assert (
        c.put(
            "/api/v1/models/profile-test",
            json={
                "name": "test",
                "base_url": "https://example.com/v1",
                "model": "test",
                "api_key": "never-show-this",
            },
        ).status_code
        == 200
    )
    assert "never-show-this" not in c.get("/api/v1/models").text
    assert "never-show-this" not in json.dumps(snapshot())
    saved = archive()
    put("subjects", "subject-second", {"title": "多余的作品"})
    restore(saved)
    assert get("watch-test")["finished"] == "2024-04"
    assert get("subject-second") is None
    assert get("admin") is not None


def test_restore_rejects_path_traversal(authenticated):
    sample()
    original = snapshot()
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("shifan.json", json.dumps(original))
        z.writestr("media/../../escape", "bad")
    with pytest.raises(ValueError):
        restore(b.getvalue())
    assert snapshot() == original


def test_cascade_and_note_watch_validation(authenticated):
    sample()
    c = authenticated
    assert (
        c.put(
            "/api/v1/records/notes/note-test",
            json={"subject_id": "subject-test", "watch_id": "missing", "text": "a"},
        ).status_code
        == 422
    )
    assert (
        c.put(
            "/api/v1/records/notes/note-test",
            json={"subject_id": "subject-test", "watch_id": "watch-test", "text": "a"},
        ).status_code
        == 200
    )
    assert c.delete("/api/v1/records/watches/watch-test").status_code == 200
    assert get("note-test")["watch_id"] == ""
    c.delete("/api/v1/records/subjects/subject-test")
    assert c.get("/api/v1/state").json()["notes"] == []


@pytest.mark.parametrize(
    "value,precision",
    [
        ("2024-02-30", "day"),
        ("2024-13", "month"),
        ("2024-1", "month"),
        ("2024", "unknown"),
    ],
)
def test_invalid_dates(value, precision):
    with pytest.raises(ValueError):
        validate_record(
            "watches",
            {
                "subject_id": "subject-a",
                "status": "completed",
                "finished": value,
                "precision": precision,
            },
            lambda _: {"title": "a"},
        )

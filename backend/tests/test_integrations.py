import asyncio
import json

import httpx
import pytest

from app import integrations, main
from app.db import get, put, read_all


def test_compatible_provider_request_and_prompt(authenticated, monkeypatch):
    original = httpx.AsyncClient
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "你好"}}]})

    monkeypatch.setattr(
        integrations.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    for base in (
        "https://api.openai.com/v1",
        "https://api.deepseek.com/v1",
        "http://localhost:11434/v1",
    ):
        put(
            "profiles",
            "profile-test",
            {
                "name": "test",
                "base_url": base,
                "model": "chosen-model",
                "key": integrations.seal("fake-key"),
            },
        )
        assert (
            asyncio.run(
                integrations.generate("profile-test", "translate", "こんにちは")
            )
            == "你好"
        )
        request = requests[-1]
        assert str(request.url) == base + "/chat/completions"
        assert request.headers["authorization"] == "Bearer fake-key"
        body = json.loads(request.content)
        assert (
            body["model"] == "chosen-model" and body["messages"][0]["role"] == "system"
        )
        assert "fake-key" not in json.dumps(body)


def test_import_preview_apply_idempotent_and_unknown_dates(authenticated, monkeypatch):
    async def request(method, path, **kwargs):
        return {
            "total": 1,
            "data": [
                {
                    "subject_id": 12,
                    "subject": {"name_cn": "测试动画"},
                    "type": 2,
                    "rate": 8,
                    "tags": ["治愈"],
                    "comment": "记住了这次相遇",
                    "updated_at": "2024-04-01T00:00:00Z",
                }
            ],
        }

    async def subject(number, **kwargs):
        return put("subjects", "bgm-12", {"title": "测试动画", "bgm_id": 12})

    monkeypatch.setattr(main.bgm, "request", request)
    monkeypatch.setattr(main.bgm, "subject", subject)
    put(
        "jobs",
        "job-preview",
        {"kind": "import-preview", "params": {"username": "test"}, "status": "pending"},
    )
    asyncio.run(main.run_job("job-preview"))
    assert get("job-preview")["status"] == "done"
    for key in ("job-apply1", "job-apply2"):
        put(
            "jobs",
            key,
            {
                "kind": "import-apply",
                "params": {"preview_id": "job-preview", "selected": [12]},
                "status": "pending",
            },
        )
        asyncio.run(main.run_job(key))
        assert get(key)["status"] == "done"
    watch = get("watch-import-12")
    assert watch["precision"] == "unknown" and watch["finished"] == ""
    assert watch["source_updated_at"] == "2024-04-01T00:00:00Z"
    assert len(read_all("watches")) == 1 and len(read_all("notes")) == 1


def test_ai_rejects_sql_and_fabricated_recommendations(authenticated, monkeypatch):
    async def malicious(*args, **kw):
        return '{"sql":"DELETE FROM documents"}'

    monkeypatch.setattr(main, "generate", malicious)
    with pytest.raises(ValueError):
        asyncio.run(main.ai_task({"task": "search", "profile_id": "fake"}))
    put("subjects", "bgm-12", {"title": "测试动画", "bgm_id": 12})
    put("watches", "watch-wish", {"subject_id": "bgm-12", "status": "wish"})

    async def invented(*args, **kw):
        return '[{"id":99999,"reason":"invented"}]'

    monkeypatch.setattr(main, "generate", invented)
    with pytest.raises(ValueError):
        asyncio.run(main.ai_task({"task": "recommend", "profile_id": "fake"}))

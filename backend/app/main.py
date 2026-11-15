import asyncio
import csv
import hashlib
import html
import io
import json
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import quote

from argon2 import PasswordHasher
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .backup import archive, restore, save_backup, snapshot
from .db import DATA, get, put, read_all, remove
from .domain import stats, today, validate_record
from .integrations import PROMPTS, bgm, generate, seal

hasher = PasswordHasher()
tasks = set()
attempts = {}
ALLOWED = {"subjects", "watches", "notes", "lists"}


def now():
    return datetime.now(timezone.utc).isoformat()


def launch(coro):
    task = asyncio.create_task(coro)
    tasks.add(task)
    task.add_done_callback(tasks.discard)


async def backups():
    while True:
        await asyncio.sleep(86400)
        await asyncio.to_thread(save_backup)


@asynccontextmanager
async def lifespan(app):
    if not get("admin"):
        password = os.getenv("ADMIN_PASSWORD", "")
        if len(password) < 12 or password == "change-this-long-password":
            raise RuntimeError("ADMIN_PASSWORD 必须设置为至少12位的自定义密码")
        put("auth", "admin", {"hash": hasher.hash(password)})
    from .integrations import cipher

    cipher()
    for job in read_all("jobs"):
        if job["status"] in ("pending", "running"):
            launch(run_job(job["id"]))
    launch(backups())
    yield
    for task in list(tasks):
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="拾番", lifespan=lifespan)


@app.middleware("http")
async def security(request: Request, call_next):
    if request.url.path.startswith("/api/v1"):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            expected = os.getenv("PUBLIC_ORIGIN", "http://localhost:8080").rstrip("/")
            if origin != expected:
                return JSONResponse({"detail": "请求来源不匹配"}, status_code=403)
        if request.url.path not in ("/api/v1/login", "/api/v1/health"):
            cookie = request.cookies.get("shifan", "")
            session = (
                get("session-" + hashlib.sha256(cookie.encode()).hexdigest())
                if cookie
                else None
            )
            if not session or session["expires"] < time.time():
                return JSONResponse({"detail": "请登录"}, status_code=401)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ValueError)
async def validation_error(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(Exception)
async def integration_error(request, exc):
    return JSONResponse(
        {"detail": "服务暂不可用，请检查连接与配置后重试"}, status_code=502
    )


@app.get("/api/v1/health")
def health():
    return {"ok": True}


class Login(BaseModel):
    password: str


@app.post("/api/v1/login")
def login(body: Login, request: Request, response: Response):
    ip = request.client.host
    recent = [t for t in attempts.get(ip, []) if time.time() - t < 900]
    attempts[ip] = recent
    if len(recent) >= 10:
        raise HTTPException(429, "尝试过多，请15分钟后再试")
    recent.append(time.time())
    try:
        hasher.verify(get("admin")["hash"], body.password)
    except Exception:
        raise HTTPException(401, "密码不正确")
    attempts.pop(ip, None)
    token = secrets.token_urlsafe(32)
    put(
        "sessions",
        "session-" + hashlib.sha256(token.encode()).hexdigest(),
        {"expires": time.time() + 604800},
    )
    response.set_cookie(
        "shifan",
        token,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "true").lower() == "true",
        samesite="strict",
        max_age=604800,
    )
    return {"ok": True}


@app.post("/api/v1/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("shifan", "")
    remove("sessions", "session-" + hashlib.sha256(token.encode()).hexdigest())
    response.delete_cookie("shifan")
    return {"ok": True}


@app.get("/api/v1/state")
def state():
    return {kind: read_all(kind) for kind in ALLOWED} | {"today": today()}


@app.put("/api/v1/records/{kind}/{key}")
def write(kind: str, key: str, body: dict):
    prefixes = {
        "subjects": ("subject-", "bgm-"),
        "watches": ("watch-",),
        "notes": ("note-",),
        "lists": ("list-",),
    }
    if (
        kind not in ALLOWED
        or not re.fullmatch(r"[a-z]+-[a-zA-Z0-9-]+", key)
        or not key.startswith(prefixes[kind])
    ):
        raise HTTPException(400, "无效记录标识")
    previous = get(key)
    if previous and not any(d["id"] == key for d in read_all(kind)):
        raise HTTPException(400, "记录类型不匹配")
    data = body | {
        "updated_at": now(),
        "created_at": (previous or {}).get("created_at", now()),
    }
    if kind == "subjects" and previous and previous.get("bgm_id"):
        data = previous | {
            "overrides": body.get("overrides", previous.get("overrides", {}))
        }
    validate_record(kind, data, get)
    return put(kind, key, data, body.get("revision"))


@app.delete("/api/v1/records/{kind}/{key}")
def delete(kind: str, key: str):
    if kind not in ALLOWED:
        raise HTTPException(400)
    if kind == "subjects":
        for related in ("watches", "notes"):
            for item in read_all(related):
                if item["subject_id"] == key:
                    remove(related, item["id"])
        for item in read_all("lists"):
            put(
                "lists",
                item["id"],
                item
                | {"subject_ids": [s for s in item.get("subject_ids", []) if s != key]},
            )
    if kind == "watches":
        for item in read_all("notes"):
            if item.get("watch_id") == key:
                put("notes", item["id"], item | {"watch_id": ""})
    remove(kind, key)
    return {"ok": True}


@app.get("/api/v1/bangumi/search")
async def search(q: str, offset: int = 0):
    if len(q) > 200 or offset < 0:
        raise ValueError("搜索条件不合法")
    number = re.fullmatch(
        r"(?:https://(?:bgm.tv|bangumi.tv|chii.in)/subject/)?(\d+)", q.strip()
    )
    if number:
        subject = await bgm.subject(int(number[1]))
        return {
            "data": [
                {
                    "id": subject["bgm_id"],
                    "name_cn": subject["title"],
                    "summary": subject["summary"],
                }
            ]
        }
    return await bgm.request(
        "POST",
        "/v0/search/subjects",
        params={"limit": 12, "offset": offset},
        json={"keyword": q, "filter": {"type": [2]}},
    )


@app.post("/api/v1/bangumi/subjects/{number}")
async def add_subject(number: int, refresh: bool = False):
    return await bgm.subject(number, refresh)


@app.post("/api/v1/bangumi/link")
async def link_subject(body: dict):
    local = get(body["local_id"])
    if not local or not body["local_id"].startswith("subject-"):
        raise ValueError("请选择手动添加的作品")
    target = await bgm.subject(int(body["bgm_id"]))
    for kind in ("watches", "notes"):
        for record in read_all(kind):
            if record["subject_id"] == local["id"]:
                put(kind, record["id"], record | {"subject_id": target["id"]})
    for record in read_all("lists"):
        put(
            "lists",
            record["id"],
            record
            | {
                "subject_ids": list(
                    dict.fromkeys(
                        target["id"] if s == local["id"] else s
                        for s in record["subject_ids"]
                    )
                )
            },
        )
    if local.get("overrides"):
        put(
            "subjects",
            target["id"],
            target | {"overrides": local["overrides"] | target.get("overrides", {})},
        )
    remove("subjects", local["id"])
    return {"id": target["id"]}


@app.put("/api/v1/bangumi/config")
def bangumi_config(body: dict):
    put("settings", "bangumi-config", {"token": seal(body.get("token", "").strip())})
    return {"ok": True}


@app.get("/api/v1/statistics")
def statistics(year: str = ""):
    return stats(read_all("watches"), read_all("subjects"), year)


@app.get("/api/v1/models")
def models():
    return [
        {k: v for k, v in p.items() if k != "key"} | {"has_key": bool(p.get("key"))}
        for p in read_all("profiles")
    ]


@app.put("/api/v1/models/{key}")
def save_model(key: str, body: dict):
    if not re.fullmatch(r"profile-[a-zA-Z0-9-]+", key):
        raise ValueError("无效模型配置标识")
    if (
        not body.get("name")
        or not body.get("model")
        or not body.get("base_url", "").startswith(("http://", "https://"))
    ):
        raise ValueError("名称、模型名和有效接口地址必填")
    previous = get(key) or {}
    encrypted = (
        seal(body["api_key"]) if body.get("api_key") else previous.get("key", "")
    )
    if not encrypted:
        raise ValueError("请填写 API Key")
    allowed = {
        k: body[k]
        for k in ("name", "model", "base_url", "timeout", "max_tokens")
        if k in body
    }
    put("profiles", key, allowed | {"key": encrypted})
    return {"ok": True}


@app.delete("/api/v1/models/{key}")
def delete_model(key: str):
    remove("profiles", key)
    return {"ok": True}


@app.get("/api/v1/prompts")
def prompts():
    return {
        name: {
            "default": default,
            "text": (get("prompt-" + name) or {}).get("text", default),
        }
        for name, default in PROMPTS.items()
    }


@app.put("/api/v1/prompts/{name}")
def prompt(name: str, body: dict):
    if name not in PROMPTS:
        raise ValueError("无效任务")
    put("prompts", "prompt-" + name, {"text": body.get("text", PROMPTS[name])})
    return {"ok": True}


@app.post("/api/v1/media")
async def upload(file: UploadFile):
    from PIL import Image

    content = await file.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024:
        raise ValueError("图片不能超过8MB")
    try:
        image = Image.open(io.BytesIO(content))
        if image.width * image.height > 24000000:
            raise ValueError()
        image.thumbnail((2400, 2400))
        name = str(uuid.uuid4()) + ".jpg"
        image.convert("RGB").save(DATA / "media" / name, quality=88)
    except Exception:
        raise ValueError("请上传有效图片，最多2400万像素")
    return {"url": "/api/v1/media/" + name}


@app.get("/api/v1/media/{name}")
def media(name: str):
    if (
        not re.fullmatch(r"[a-zA-Z0-9-]+\.(jpg|png)", name)
        or not (DATA / "media" / name).is_file()
    ):
        raise HTTPException(404)
    return FileResponse(DATA / "media" / name)


@app.get("/api/v1/export/{format}")
def export(format: str):
    if format == "zip":
        return Response(
            archive(),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=shifan.zip"},
        )
    if format == "json":
        return Response(
            json.dumps(snapshot(), ensure_ascii=False),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=shifan.json"},
        )
    subjects = {s["id"]: s["title"] for s in read_all("subjects")}
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["作品", "状态", "看完时间", "精度", "评分", "进度"])
        for w in read_all("watches"):
            title = subjects.get(w["subject_id"], "")
            if title.startswith(("=", "+", "-", "@")):
                title = "'" + title
            writer.writerow(
                [
                    title,
                    w["status"],
                    w.get("finished"),
                    w.get("precision"),
                    w.get("score"),
                    w.get("progress", 0),
                ]
            )
        return Response(
            "\ufeff" + output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=shifan.csv"},
        )
    if format == "markdown":
        text = "\n\n".join(
            f"# {subjects.get(n['subject_id'], '')}\n\n{n.get('created_at', '')}\n\n{n.get('text', '')}"
            for n in read_all("notes")
        )
        return Response(
            text,
            media_type="text/markdown",
            headers={"Content-Disposition": "attachment; filename=shifan.md"},
        )
    raise HTTPException(404)


@app.post("/api/v1/restore")
async def restore_backup(file: UploadFile):
    content = await file.read(100 * 1024 * 1024 + 1)
    if len(content) > 100 * 1024 * 1024:
        raise ValueError("备份不能超过100MB")
    await asyncio.to_thread(restore, content)
    return {"ok": True}


@app.post("/api/v1/backup")
def manual_backup():
    return {"name": save_backup()}


@app.get("/api/v1/backups")
def backup_list():
    return [p.name for p in sorted((DATA / "backups").glob("*.zip"), reverse=True)]


@app.get("/api/v1/backups/{name}")
def download_backup(name: str):
    if (
        not re.fullmatch(r"[0-9-]+\.zip", name)
        or not (DATA / "backups" / name).is_file()
    ):
        raise HTTPException(404)
    return FileResponse(DATA / "backups" / name, filename=name)


class JobRequest(BaseModel):
    kind: str
    params: dict = Field(default_factory=dict)


@app.post("/api/v1/jobs")
async def create_job(body: JobRequest):
    if body.kind not in ("ai", "import-preview", "import-apply", "share"):
        raise ValueError("无效任务")
    key = "job-" + str(uuid.uuid4())
    put(
        "jobs",
        key,
        {
            "kind": body.kind,
            "params": body.params,
            "status": "pending",
            "created_at": now(),
        },
    )
    launch(run_job(key))
    return {"id": key}


@app.get("/api/v1/jobs/{key}")
def job_status(key: str):
    job = get(key)
    if not job or not key.startswith("job-"):
        raise HTTPException(404)
    return job


async def ai_task(p):
    task = p.get("task", "translate")
    if task not in PROMPTS:
        raise ValueError("未知模型任务")
    context = ""
    if task in ("year", "recommend"):
        watches = [
            w
            for w in read_all("watches")
            if not p.get("year") or w.get("finished", "").startswith(p["year"])
        ]
        subject_ids = {w["subject_id"] for w in watches}
        watch_ids = {w["id"] for w in watches}
        context = json.dumps(
            {
                "watches": watches,
                "subjects": [
                    {"id": s["id"], "title": s["title"]}
                    for s in read_all("subjects")
                    if s["id"] in subject_ids
                ],
                "notes": [
                    n
                    for n in read_all("notes")
                    if n["subject_id"] in subject_ids
                    and (
                        not p.get("year")
                        or n.get("watch_id") in watch_ids
                        or n.get("created_at", "").startswith(p["year"])
                    )
                    and (p.get("include_spoilers") or not n.get("spoiler"))
                ],
            },
            ensure_ascii=False,
        )
        if task == "recommend":
            candidates = [
                {"id": s.get("bgm_id"), "title": s["title"]}
                for s in read_all("subjects")
                if s["id"]
                in {
                    w["subject_id"]
                    for w in read_all("watches")
                    if w["status"] == "wish"
                }
            ]
            if p.get("keyword"):
                raw = await bgm.request(
                    "POST",
                    "/v0/search/subjects",
                    params={"limit": 10},
                    json={"keyword": p["keyword"], "filter": {"type": [2]}},
                )
                candidates += [
                    {"id": s["id"], "title": s.get("name_cn") or s["name"]}
                    for s in raw.get("data", [])
                ]
            if not candidates:
                raise ValueError("请先添加想看作品或输入候选搜索词")
            context += "\n候选：" + json.dumps(candidates, ensure_ascii=False)
    text = p.get("text", "")
    if task == "search":
        # First retrieve candidates locally. Model only extracts validated filters.
        context = ""
    if task == "recommend":
        context += '\n输出要求：仅输出 JSON 数组，每项为 {"id":候选的整数Bangumi ID,"reason":"推荐理由"}。最多五项。'
    result = await generate(p["profile_id"], task, text, context, p.get("prompt"))
    if task == "recommend":
        recommendations = json.loads(
            result.removeprefix("```json").removesuffix("```").strip()
        )
        allowed = {c["id"]: c["title"] for c in candidates if c.get("id")}
        if not isinstance(recommendations, list) or len(recommendations) > 5:
            raise ValueError("推荐格式不符合要求，请重试")
        lines = []
        for item in recommendations:
            if (
                not isinstance(item, dict)
                or item.get("id") not in allowed
                or not isinstance(item.get("reason"), str)
            ):
                raise ValueError("模型引用了候选之外的作品，结果未采用，请重试")
            lines.append(
                f"- [{allowed[item['id']]}](https://bgm.tv/subject/{item['id']})：{item['reason']}"
            )
        return {"text": "\n".join(lines) or "当前候选中没有合适推荐，请换一个搜索词。"}
    if task == "search":
        parsed = json.loads(result.removeprefix("```json").removesuffix("```").strip())
        if not isinstance(parsed, dict) or set(parsed) - {
            "keyword",
            "status",
            "year",
            "tag",
            "min_score",
        }:
            raise ValueError("模型返回了不支持的搜索条件")
        if any(not isinstance(v, (str, int)) for v in parsed.values()):
            raise ValueError("搜索条件格式不正确")
        if parsed.get("status") and parsed["status"] not in (
            "wish",
            "watching",
            "completed",
            "paused",
            "dropped",
        ):
            raise ValueError("模型返回无效观看状态")
        if "year" in parsed and not re.fullmatch(r"\d{4}", str(parsed["year"])):
            raise ValueError("模型返回无效年份")
        if "min_score" in parsed and (
            type(parsed["min_score"]) is not int or not 1 <= parsed["min_score"] <= 10
        ):
            raise ValueError("模型返回无效评分")
        subjects = read_all("subjects")
        watches = read_all("watches")
        notes = read_all("notes")
        found = []
        for s in subjects:
            related = [w for w in watches if w["subject_id"] == s["id"]]
            term = str(parsed.get("keyword", "")).casefold()
            haystack = (
                s["title"]
                + " "
                + " ".join(
                    n.get("text", "")
                    for n in notes
                    if n["subject_id"] == s["id"] and not n.get("spoiler")
                )
            )
            if term and term not in haystack.casefold():
                continue
            if any(k in parsed for k in ("status", "year", "tag", "min_score")):
                related = [
                    w
                    for w in related
                    if (not parsed.get("status") or w["status"] == parsed["status"])
                    and (
                        not parsed.get("year")
                        or w.get("finished", "").startswith(str(parsed["year"]))
                    )
                    and (not parsed.get("tag") or parsed["tag"] in w.get("tags", []))
                    and (
                        not parsed.get("min_score")
                        or (w.get("score") or 0) >= int(parsed["min_score"])
                    )
                ]
                if not related:
                    continue
            found.append(s["id"])
        return {
            "text": "找到 " + str(len(found)) + " 部作品",
            "subject_ids": found,
            "filters": parsed,
        }
    return {"text": result}


async def run_job(key):
    job = get(key)
    put("jobs", key, job | {"status": "running"})
    try:
        p = job["params"]
        if job["kind"] == "ai":
            result = await ai_task(p)
        elif job["kind"] == "import-preview":
            username = quote(p["username"], safe="")
            records, offset = [], 0
            while True:
                payload = await bgm.request(
                    "GET",
                    f"/v0/users/{username}/collections",
                    params={"subject_type": 2, "limit": 50, "offset": offset},
                )
                batch = payload.get("data", [])
                records.extend(batch)
                if not batch or offset + len(batch) >= payload.get("total", 0):
                    break
                offset += len(batch)
            result = {
                "items": [
                    {
                        "subject_id": i["subject_id"],
                        "title": (i.get("subject") or {}).get("name_cn")
                        or (i.get("subject") or {}).get("name", str(i["subject_id"])),
                        "status": {
                            1: "wish",
                            2: "completed",
                            3: "watching",
                            4: "paused",
                            5: "dropped",
                        }.get(i.get("type"), "wish"),
                        "score": i.get("rate") or None,
                        "tags": i.get("tags", []),
                        "comment": i.get("comment", ""),
                        "source_updated_at": i.get("updated_at"),
                        "conflict": bool(
                            get("watch-import-" + str(i["subject_id"]))
                            or any(
                                w["subject_id"] == "bgm-" + str(i["subject_id"])
                                for w in read_all("watches")
                            )
                        ),
                    }
                    for i in records
                ]
            }
        elif job["kind"] == "import-apply":
            preview = get(p["preview_id"])
            if (
                not preview
                or preview.get("kind") != "import-preview"
                or preview["status"] != "done"
            ):
                raise ValueError("请先完成导入预览")
            selected = set(p["selected"])
            count = 0
            for item in preview["result"]["items"]:
                if item["subject_id"] not in selected:
                    continue
                subject = await bgm.subject(item["subject_id"])
                wkey = "watch-import-" + str(item["subject_id"])
                existing = get(wkey)
                # Conflicts require selecting this item explicitly in preview; local records are never overwritten.
                if existing:
                    continue
                put(
                    "watches",
                    wkey,
                    {
                        "subject_id": subject["id"],
                        "status": item["status"],
                        "score": item["score"],
                        "tags": item["tags"],
                        "precision": "unknown",
                        "finished": "",
                        "progress": 0,
                        "created_at": now(),
                        "source_updated_at": item["source_updated_at"],
                    },
                )
                if item["comment"]:
                    put(
                        "notes",
                        "note-import-" + str(item["subject_id"]),
                        {
                            "subject_id": subject["id"],
                            "watch_id": wkey,
                            "text": item["comment"],
                            "spoiler": False,
                            "created_at": now(),
                            "source": "bangumi",
                        },
                    )
                count += 1
            result = {"text": f"导入完成，新增 {count} 条观看经历；已有导入记录跳过"}
        else:
            result = await render_share(key, p)
        put(
            "jobs",
            key,
            get(key) | {"status": "done", "result": result, "finished_at": now()},
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        message = (
            str(exc)
            if isinstance(exc, (ValueError, KeyError))
            else "任务失败，请检查网络、服务配置或 Chromium 安装后重试"
        )
        put("jobs", key, get(key) | {"status": "failed", "error": message})


async def render_share(key, p):
    from playwright.async_api import async_playwright
    import base64

    subjects = {s["id"]: s for s in read_all("subjects")}
    chosen = set(p.get("watch_ids", []))
    watches = [w for w in read_all("watches") if w["id"] in chosen]
    watches.sort(key=lambda w: w.get("finished", ""), reverse=True)
    cards = []
    for w in watches:
        s = subjects[w["subject_id"]]
        cover = s.get("cover", "").split("/")[-1]
        image = ""
        if (
            re.fullmatch(r"[a-zA-Z0-9-]+\.jpg", cover)
            and (DATA / "media" / cover).exists()
        ):
            image = (
                '<img src="data:image/jpeg;base64,'
                + base64.b64encode((DATA / "media" / cover).read_bytes()).decode()
                + '">'
            )
        note = ""
        if p.get("include_notes"):
            note = "\n".join(
                n["text"]
                for n in read_all("notes")
                if n.get("watch_id") == w["id"]
                and (p.get("include_spoilers") or not n.get("spoiler"))
            )
        cards.append(
            f"<article>{image}<div><small>{html.escape(w.get('finished') or '时间未记')} · {html.escape(w['status'])}</small><h2>{html.escape(s['title'])}</h2><p>{('★ ' + str(w.get('score') or '未评分')) if p.get('include_scores') else ''}</p><p>{html.escape(note)}</p></div></article>"
        )
    if not cards:
        raise ValueError("请至少选择一条观看记录")
    urls = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=["--no-sandbox"])
        try:
            page = await browser.new_page(
                viewport={"width": 900, "height": 1000}, device_scale_factor=1.5
            )
            await page.route("**/*", lambda route: route.abort())
            for offset in range(0, len(cards), 8):
                title = html.escape(
                    p.get("title")
                    or {
                        "timeline": "我的动画足迹",
                        "year": "这一年的动画记忆",
                        "subject": "关于这部动画",
                    }.get(p.get("template"), "我的动画足迹")
                )
                content = (
                    '<html><meta charset="utf-8"><style>body{margin:0;padding:55px;background:#faf6ee;color:#403c35;font:20px sans-serif}h1{font-size:42px}small{color:#918574}article{display:flex;gap:24px;padding:24px 0;border-bottom:1px solid #ddd3c0;break-inside:avoid}img{width:115px;height:160px;object-fit:cover;border-radius:10px}p{white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:35px;color:#918574}</style><h1>'
                    + title
                    + "</h1><p>"
                    + html.escape(p.get("nickname", ""))
                    + "</p>"
                    + "".join(cards[offset : offset + 8])
                    + f"<footer>拾番 · 私藏的动画记忆 · {offset // 8 + 1}</footer></html>"
                )
                await page.set_content(content)
                await page.evaluate("document.fonts.ready")
                name = f"{key}-{offset // 8}.png"
                await page.screenshot(path=str(DATA / "media" / name), full_page=True)
                urls.append("/api/v1/media/" + name)
        finally:
            await browser.close()
    return {"images": urls}

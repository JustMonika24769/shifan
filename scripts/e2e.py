"""Local end-to-end acceptance; owns isolated data and tears down its servers."""

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

from cryptography.fernet import Fernet
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
env = os.environ | {
    "DATA_DIR": str(ROOT / ".e2e-data" / str(uuid.uuid4())),
    "ADMIN_PASSWORD": "e2e-only-long-password",
    "MASTER_KEY": Fernet.generate_key().decode(),
    "PUBLIC_ORIGIN": "http://127.0.0.1:18765",
    "COOKIE_SECURE": "false",
    "SHIFAN_BACKEND": "http://127.0.0.1:18764",
    "PLAYWRIGHT_BROWSERS_PATH": str(ROOT / ".browsers"),
}
flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
processes = []
logs = []
try:
    migration = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT / "backend",
        env=env,
        check=True,
        creationflags=flags,
    )
    for command, cwd in [
        (
            [sys.executable, "-m", "uvicorn", "app.main:app", "--port", "18764"],
            ROOT / "backend",
        ),
        (
            [
                "node",
                "node_modules/vite/bin/vite.js",
                "--host",
                "127.0.0.1",
                "--port",
                "18765",
                "--strictPort",
            ],
            ROOT / "frontend",
        ),
    ]:
        log = open(ROOT / (".e2e-" + str(len(logs)) + ".log"), "w", encoding="utf-8")
        logs.append(log)
        processes.append(
            subprocess.Popen(
                command, cwd=cwd, env=env, stdout=log, stderr=log, creationflags=flags
            )
        )
    import httpx

    for _ in range(60):
        try:
            if (
                httpx.get(
                    "http://127.0.0.1:18764/api/v1/health", timeout=1, trust_env=False
                ).status_code
                == 200
                and httpx.get(
                    "http://127.0.0.1:18765", timeout=1, trust_env=False
                ).status_code
                == 200
            ):
                break
        except httpx.HTTPError:
            pass
        time.sleep(1)
    else:
        raise RuntimeError("servers did not start")
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = env["PLAYWRIGHT_BROWSERS_PATH"]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:18765")
        page.get_by_label("日记密码").fill(env["ADMIN_PASSWORD"])
        page.get_by_role("button", name="打开日记").click()
        page.get_by_role("heading", name="故事散场，记忆留下。").wait_for()
        # Seed deterministic private data via authenticated API, never real credentials.
        headers = {"origin": env["PUBLIC_ORIGIN"]}

        def write(kind, key, body):
            r = page.request.put(
                f"http://127.0.0.1:18765/api/v1/records/{kind}/{key}",
                data=body,
                headers=headers,
            )
            assert r.ok, r.text()

        write(
            "subjects",
            "subject-frieren",
            {
                "title": "葬送的芙莉莲",
                "original_title": "葬送のフリーレン",
                "summary": "这是一个关于时间、相遇和重新理解旅途的故事。",
                "air_date": "2023-09-29",
                "platform": "TV",
                "tags": ["奇幻", "公路"],
                "episodes": 28,
            },
        )
        write(
            "subjects",
            "subject-bocchi",
            {
                "title": "孤独摇滚！",
                "air_date": "2022-10-08",
                "platform": "TV",
                "episodes": 12,
                "tags": ["音乐", "日常"],
            },
        )
        write(
            "subjects",
            "subject-summer",
            {
                "title": "夏目友人帐",
                "air_date": "2008-07-07",
                "platform": "TV",
                "episodes": 13,
                "tags": ["治愈"],
            },
        )
        write(
            "watches",
            "watch-frieren",
            {
                "subject_id": "subject-frieren",
                "status": "completed",
                "finished": "2024-04",
                "precision": "month",
                "score": 9,
                "progress": 28,
                "tags": ["治愈", "想再看一次"],
            },
        )
        write(
            "watches",
            "watch-bocchi",
            {
                "subject_id": "subject-bocchi",
                "status": "completed",
                "finished": "2024-03-28",
                "precision": "day",
                "score": 9,
                "progress": 12,
                "tags": ["音乐", "青春"],
            },
        )
        write(
            "watches",
            "watch-summer",
            {
                "subject_id": "subject-summer",
                "status": "watching",
                "finished": "",
                "precision": "unknown",
                "score": None,
                "progress": 5,
                "tags": [],
            },
        )
        write(
            "notes",
            "note-frieren",
            {
                "subject_id": "subject-frieren",
                "watch_id": "watch-frieren",
                "text": "比起抵达终点，原来路上的那些小事才更值得记住。\n\n想起了以前一起旅行的人，有机会还想再见一面。",
                "spoiler": False,
            },
        )
        page.reload()
        page.get_by_role("heading", name="故事散场，记忆留下。").wait_for()
        assert page.get_by_text("2024-04-01", exact=True).count() == 0
        (ROOT / "docs").mkdir(exist_ok=True)
        page.add_style_tag(content=".entry{content-visibility:visible!important}")
        page.screenshot(path=str(ROOT / "docs/desktop.png"), full_page=True)
        page.get_by_role("button", name="记一部动画", exact=True).click()
        page.get_by_text("找不到？手动添加作品").click()
        page.get_by_label("名称", exact=True).fill("浏览器验收动画")
        page.get_by_role("button", name="添加并记录").click()
        page.get_by_label("时间精度").select_option("month")
        page.get_by_label("看完时间").fill("2024-04")
        page.get_by_label("一句话感想（可选）").fill("UI 保存验收")
        page.get_by_role("button", name="收进日记").click()
        page.get_by_text("已收进日记", exact=True).wait_for()
        page.get_by_role("button", name="浏览器验收动画", exact=True).first.click()
        page.get_by_role("button", name="＋ 记录观看 / 重看").click()
        page.get_by_label("时间精度").select_option("year")
        page.get_by_label("看完时间").fill("2026")
        page.get_by_role("button", name="收进日记").click()
        page.get_by_text("2026 · 月份未定", exact=True).wait_for()
        page.get_by_role("button", name="分享足迹").click()
        page.get_by_role("button", name="生成预览").click()
        preview = page.get_by_alt_text("分享预览 1")
        preview.wait_for(timeout=60000)
        assert preview.evaluate("(img)=>img.complete && img.naturalWidth>0")
        page.get_by_role("button", name="关闭", exact=True).click()
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator(".toast").wait_for(state="hidden")
        page.screenshot(path=str(ROOT / "docs/mobile.png"), full_page=True)
        assert page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth"
        ), "mobile horizontal overflow"
        page.get_by_role("button", name="时光回顾", exact=True).click()
        page.get_by_role("heading", name="时光里的动画记忆").wait_for()
        page.locator('div[role="img"]').wait_for(timeout=15000)
        assert not errors, errors
        browser.close()
        print(
            "PASS: login, CRUD, precision, rewatch, notes, PNG share, mobile layout, charts; screenshots in docs/"
        )
finally:
    for process in reversed(processes):
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
    for log in logs:
        log.close()

from collections import Counter
from datetime import date, datetime
from zoneinfo import ZoneInfo

STATUSES = ["wish", "watching", "completed", "paused", "dropped"]


def today():
    return datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()


def validate_record(kind, data, lookup):
    if kind == "notes":
        if not isinstance(data.get("text"), str) or len(data["text"]) > 200000:
            raise ValueError("感想必须为文本，最多二十万字符")
    if kind == "lists":
        if not isinstance(data.get("subject_ids", []), list) or any(
            not lookup(s) or not lookup(s).get("title")
            for s in data.get("subject_ids", [])
        ):
            raise ValueError("片单包含不存在的作品")
    if kind == "subjects":
        if not str(data.get("title", "")).strip():
            raise ValueError("作品名称不能为空")
    if kind in ("watches", "notes"):
        subject = lookup(data.get("subject_id", ""))
        if not subject or not subject.get("title"):
            raise ValueError("关联作品不存在")
    if kind == "watches":
        if data.get("status") not in STATUSES:
            raise ValueError("无效观看状态")
        score = data.get("score")
        if score is not None and (type(score) is not int or not 1 <= score <= 10):
            raise ValueError("评分应为 1—10 的整数")
        precision = data.get("precision", "unknown")
        value = data.get("finished", "")
        formats = {"day": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y"}
        if precision != "unknown":
            if precision not in formats:
                raise ValueError("无效日期精度")
            try:
                parsed = datetime.strptime(value, formats[precision])
                if parsed.strftime(formats[precision]) != value:
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValueError("日期与精度不匹配")
        elif value:
            raise ValueError("未知日期应留空")
        if not isinstance(data.get("progress", 0), int) or data.get("progress", 0) < 0:
            raise ValueError("进度不能小于零")
        if data.get("started"):
            date.fromisoformat(data["started"])
    if kind == "notes" and data.get("watch_id"):
        watch = lookup(data["watch_id"])
        if not watch or watch.get("subject_id") != data["subject_id"]:
            raise ValueError("感想与观看经历不匹配")
    if kind == "lists" and not data.get("title", "").strip():
        raise ValueError("片单标题不能为空")


def stats(watches, subjects, year=""):
    done = [
        w
        for w in watches
        if w["status"] == "completed"
        and (not year or w.get("finished", "").startswith(year))
    ]
    by_id = {s["id"]: s for s in subjects}
    return {
        "completions": len(done),
        "unique": len({w["subject_id"] for w in done}),
        "months": dict(
            sorted(
                Counter(
                    w["finished"][:7]
                    for w in done
                    if w.get("precision") in ("day", "month")
                ).items()
            )
        ),
        "scores": dict(Counter(str(w["score"]) for w in done if w.get("score"))),
        "tags": dict(Counter(t for w in done for t in w.get("tags", []))),
        "types": dict(
            Counter(
                by_id.get(w["subject_id"], {}).get("platform", "未知") or "未知"
                for w in done
            )
        ),
        "air_years": dict(
            Counter(
                by_id.get(w["subject_id"], {}).get("air_date", "")[:4] or "未知"
                for w in done
            )
        ),
        "unknown_dates": sum(w.get("precision") == "unknown" for w in done),
    }

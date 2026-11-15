import io
import json
import zipfile
from datetime import datetime

from .db import DATA, Document, Session

KINDS = {"subjects", "watches", "notes", "lists"}


def snapshot():
    with Session() as db:
        return {
            "version": 1,
            "documents": [
                {"id": d.id, "kind": d.kind, "body": json.loads(d.body)}
                for d in db.query(Document).filter(Document.kind.in_(KINDS)).all()
            ],
        }


def archive():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("shifan.json", json.dumps(snapshot(), ensure_ascii=False))
        for p in (DATA / "media").iterdir():
            if p.is_file():
                z.write(p, "media/" + p.name)
    return output.getvalue()


def save_backup():
    name = datetime.now().strftime("%Y%m%d-%H%M%S-%f.zip")
    (DATA / "backups" / name).write_bytes(archive())
    for old in sorted((DATA / "backups").glob("*.zip"), reverse=True)[7:]:
        old.unlink()
    return name


def restore(content):
    from .domain import validate_record

    with zipfile.ZipFile(io.BytesIO(content)) as z:
        if sum(i.file_size for i in z.infolist()) > 250 * 1024 * 1024:
            raise ValueError("备份解压后不能超过 250MB")
        payload = json.loads(z.read("shifan.json"))
        if payload.get("version") != 1 or not isinstance(
            payload.get("documents"), list
        ):
            raise ValueError("不支持的备份格式或版本")
        documents = payload["documents"]
        ids = {d["id"] for d in documents}
        if len(ids) != len(documents):
            raise ValueError("备份存在重复记录")
        bodies = {d["id"]: d["body"] for d in documents}
        for d in documents:
            prefixes = {
                "subjects": "subject-",
                "watches": "watch-",
                "notes": "note-",
                "lists": "list-",
            }
            if d["kind"] not in KINDS or not d["id"].startswith(
                prefixes.get(d["kind"], "!")
            ):
                if not (d["kind"] == "subjects" and d["id"].startswith("bgm-")):
                    raise ValueError("非法记录类型或标识")
            validate_record(d["kind"], d["body"], bodies.get)
        media = {}
        for name in z.namelist():
            if name.startswith("media/"):
                leaf = name[6:]
                if not leaf or "/" in leaf or "\\" in leaf or leaf in (".", ".."):
                    raise ValueError("非法媒体路径")
                media[leaf] = z.read(name)
        save_backup()
        with Session.begin() as db:
            db.query(Document).filter(Document.kind.in_(KINDS)).delete(
                synchronize_session=False
            )
            for d in documents:
                db.add(
                    Document(
                        id=d["id"],
                        kind=d["kind"],
                        body=json.dumps(d["body"], ensure_ascii=False),
                    )
                )
        for name, data in media.items():
            (DATA / "media" / name).write_bytes(data)

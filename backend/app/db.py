import json
import os
from pathlib import Path

from sqlalchemy import Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATA = Path(os.getenv("DATA_DIR", "./data")).resolve()
DATA.mkdir(parents=True, exist_ok=True)
(DATA / "media").mkdir(exist_ok=True)
(DATA / "backups").mkdir(exist_ok=True)
engine = create_engine(
    f"sqlite:///{DATA / 'shifan.db'}", connect_args={"check_same_thread": False}
)


@event.listens_for(engine, "connect")
def pragmas(connection, _):
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")


class Base(DeclarativeBase):
    pass


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String, index=True)
    body: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)


Session = sessionmaker(engine, expire_on_commit=False)


def read_all(kind):
    with Session() as db:
        return [
            json.loads(d.body) | {"id": d.id, "revision": d.revision}
            for d in db.query(Document).filter_by(kind=kind).all()
        ]


def get(key):
    with Session() as db:
        d = db.get(Document, key)
        return (
            (json.loads(d.body) | {"id": d.id, "revision": d.revision}) if d else None
        )


def put(kind, key, body, expected=None):
    with Session.begin() as db:
        d = db.get(Document, key)
        if d and d.kind != kind:
            raise ValueError("记录类型不匹配")
        if d and expected is not None and d.revision != expected:
            raise ValueError("记录已在其他页面修改，请刷新后重试")
        clean = {k: v for k, v in body.items() if k not in ("id", "revision")}
        if d:
            d.body = json.dumps(clean, ensure_ascii=False)
            d.revision += 1
        else:
            db.add(
                Document(id=key, kind=kind, body=json.dumps(clean, ensure_ascii=False))
            )
    return get(key)


def remove(kind, key):
    with Session.begin() as db:
        db.query(Document).filter_by(id=key, kind=kind).delete()

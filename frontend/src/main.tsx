import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BookOpen,
  Library,
  ChartNoAxesCombined,
  Settings,
  Plus,
  Search,
  X,
  ArrowUpRight,
  Leaf,
  Download,
  LogOut,
  Sparkles,
  Share2,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, uid, statuses, State, Subject, Watch, Note, List } from "./api";
import "./style.css";
const Charts = lazy(() => import("./Charts"));
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const taskNames: Record<string, string> = {
  translate: "简介翻译",
  polish: "感想整理",
  search: "智能查找",
  year: "年度总结",
  recommend: "下一部看什么",
};
const pretty = (s: Subject) => ({ ...s, ...s.overrides });
function App() {
  const qc = useQueryClient();
  const state = useQuery<State>({
    queryKey: ["state"],
    queryFn: () => api("/state"),
  });
  const [tab, setTab] = useState("diary"),
    [modal, setModal] = useState<React.ReactNode>(null),
    [toast, setToast] = useState("");
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 5000);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["state"] });
  const close = () => setModal(null);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const getFocusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, textarea, select, a[href]",
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
    getFocusable()[0]?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
      if (event.key === "Tab") {
        const elements = getFocusable();
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [modal]);
  async function save(kind: string, record: any) {
    await api(`/records/${kind}/${record.id}`, record, "PUT");
    await refresh();
  }
  async function del(kind: string, id: string) {
    if (confirm("确定删除？关联内容也可能被删除，此操作无法撤销。")) {
      await api(`/records/${kind}/${id}`, undefined, "DELETE");
      await refresh();
      close();
    }
  }
  function editWatch(subject: Subject, existing?: Watch) {
    setModal(
      <WatchEditor
        subject={subject}
        existing={existing}
        today={state.data!.today}
        onSave={async (w: Watch, text: string) => {
          await save("watches", w);
          if (text)
            await save("notes", {
              id: uid("note"),
              subject_id: subject.id,
              watch_id: w.id,
              text,
              spoiler: false,
            });
          localStorage.removeItem(
            "shifan-watch-" + (existing?.id || subject.id),
          );
          close();
          notify("已收进日记");
        }}
      />,
    );
  }
  function editNote(subject: Subject, watch?: Watch, existing?: Note) {
    setModal(
      <NoteEditor
        subject={subject}
        watch={watch}
        existing={existing}
        onSave={async (n: Note) => {
          await save("notes", n);
          localStorage.removeItem(
            "shifan-note-" + (existing?.id || watch?.id || subject.id),
          );
          close();
          notify("感想已保存");
        }}
      />,
    );
  }
  function openSubject(subject: Subject) {
    setModal(
      <SubjectDetail
        subject={subject}
        state={state.data!}
        save={save}
        editWatch={editWatch}
        editNote={editNote}
        remove={del}
        notify={notify}
        ai={(task: string, text: string) => openAI(task, text, subject)}
      />,
    );
  }
  function openAI(task = "translate", text = "", subject?: Subject) {
    setModal(
      <AI
        initialTask={task}
        initialText={text}
        state={state.data!}
        onSave={async (text: string, task: string, original: string) => {
          if (!subject) throw Error("请从作品详情进入整理功能后保存");
          if (task === "translate") {
            await save("subjects", {
              ...subject,
              overrides: { ...subject.overrides, summary_translation: text },
            });
          } else {
            await save("notes", {
              id: uid("note"),
              subject_id: subject.id,
              text,
              original_text: original,
              spoiler: false,
            });
          }
          notify(
            task === "translate"
              ? "译文已保存，原文保留"
              : "已另存为感想，原文保留",
          );
        }}
        onFound={(ids: string[]) => {
          setTab("library");
          setFilterIds(ids);
          close();
        }}
      />,
    );
  }
  const [filterIds, setFilterIds] = useState<string[] | null>(null);
  if (state.error?.message === "请登录") return <Login done={refresh} />;
  if (!state.data)
    return (
      <div className="loading">
        {state.isError ? (
          <>
            <p>{state.error.message}</p>
            <button onClick={() => state.refetch()}>重试</button>
          </>
        ) : (
          "正在打开你的日记…"
        )}
      </div>
    );
  const data = state.data;
  const newSearch = () =>
    setModal(
      <SearchDialog
        onAdd={async (s: Subject) => {
          await refresh();
          close();
          editWatch(s);
        }}
      />,
    );
  return (
    <div className="app">
      <aside>
        <a className="brand" href="#" onClick={() => setTab("diary")}>
          <Leaf size={27} />
          <span>
            拾番<small>ANIME JOURNAL</small>
          </span>
        </a>
        <p className="aside-note">
          把喜欢的故事，
          <br />
          留在生活里。
        </p>
        <nav>
          {[
            ["diary", "我的日记", BookOpen],
            ["library", "作品收藏", Library],
            ["review", "时光回顾", ChartNoAxesCombined],
            ["settings", "偏好设置", Settings],
          ].map(([id, label, Icon]: any) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <span>PRIVATE LITTLE UNIVERSE</span>
          <button
            onClick={async () => {
              await api("/logout", {});
              qc.clear();
              location.reload();
            }}
          >
            <LogOut size={15} />
            退出日记
          </button>
        </div>
      </aside>
      <main>
        <header>
          <span>我的私人动画手账</span>
          <button className="quiet" onClick={() => openAI("recommend")}>
            <Sparkles size={16} /> 灵感助手
          </button>
        </header>
        {tab === "diary" && (
          <Diary
            data={data}
            openSubject={openSubject}
            editWatch={editWatch}
            editNote={editNote}
            search={newSearch}
            share={() => setModal(<Share state={data} />)}
          />
        )}
        {tab === "library" && (
          <LibraryPage
            data={data}
            filterIds={filterIds}
            reset={() => setFilterIds(null)}
            openSubject={openSubject}
            search={newSearch}
            save={save}
            notify={notify}
          />
        )}
        {tab === "review" && (
          <Review
            data={data}
            ai={() => openAI("year")}
            share={() => setModal(<Share state={data} />)}
          />
        )}
        {tab === "settings" && (
          <SettingsPage notify={notify} refreshed={refresh} state={data} />
        )}
        <footer>拾番 · 每一个故事，都有属于你的时间。</footer>
      </main>
      <button className="floating" title="记录一部动画" onClick={newSearch}>
        <Plus />
      </button>
      {modal && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <section className="modal" role="dialog" aria-modal="true">
            <button className="close" aria-label="关闭" onClick={close}>
              <X />
            </button>
            {modal}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
function Login({ done }: { done: () => void }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="login">
      <Leaf size={45} />
      <h1>拾番</h1>
      <p>欢迎回到你的动画日记。</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/login", { password });
            done();
          } catch (e: any) {
            setError(e.message);
          }
        }}
      >
        <label>
          日记密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="primary">
          打开日记 <ArrowUpRight size={16} />
        </button>
        <p className="error">{error}</p>
      </form>
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
function Cover({ subject }: { subject: Subject }) {
  return subject.cover ? (
    <img
      className="cover"
      src={subject.cover}
      alt={subject.title}
      loading="lazy"
    />
  ) : (
    <div className="cover placeholder">
      <Leaf />
      <span>{subject.title.slice(0, 8)}</span>
    </div>
  );
}
function Diary({ data, openSubject, editWatch, editNote, search, share }: any) {
  const [year, setYear] = useState(""),
    [mode, setMode] = useState("all");
  const subjects = new Map<string, Subject>(
    data.subjects.map((s: Subject) => [s.id, pretty(s)]),
  );
  const events = [
    ...data.watches
      .filter((w: Watch) => mode === "status" || w.status === "completed")
      .map((w: Watch) => ({
        id: w.id,
        subject_id: w.subject_id,
        date: w.finished || "",
        precision: w.precision,
        watch: w,
      })),
    ...(mode === "status"
      ? []
      : data.notes.map((n: Note) => ({
          id: n.id,
          subject_id: n.subject_id,
          date: n.created_at?.slice(0, 10) || "",
          precision: "day",
          note: n,
        }))),
  ]
    .filter((e: any) => !year || e.date.startsWith(year))
    .sort((a: any, b: any) => b.date.localeCompare(a.date));
  const watching = data.watches.filter((w: Watch) => w.status === "watching");
  const years = [
    ...new Set(
      data.watches.map((w: Watch) => w.finished?.slice(0, 4)).filter(Boolean),
    ),
  ]
    .sort()
    .reverse();
  let last = "";
  return (
    <>
      <Heading
        eyebrow="THE STORIES WE KEEP"
        title="故事散场，记忆留下。"
        description="那些看过的世界，也成为了你的一部分。"
      >
        <button onClick={share}>
          <Share2 size={16} />
          分享足迹
        </button>
        <button className="primary" onClick={search}>
          <Plus size={17} />
          记一部动画
        </button>
      </Heading>
      <div className="summary-strip">
        <div>
          <b>{data.subjects.length}</b>
          <span>部作品被珍藏</span>
        </div>
        <div>
          <b>
            {data.watches.filter((w: Watch) => w.status === "completed").length}
          </b>
          <span>次故事的完结</span>
        </div>
        <div>
          <b>{data.notes.length}</b>
          <span>段心情与感想</span>
        </div>
        <div className="strip-quote">「 让记忆，有迹可循。 」</div>
      </div>
      {watching.length > 0 && (
        <section>
          <div className="section-title">
            <h2>
              故事正在发生 <small>在看</small>
            </h2>
          </div>
          <div className="watching-row">
            {watching.slice(0, 4).map((w: Watch) => {
              const s = subjects.get(w.subject_id)!;
              return (
                <button
                  className="watching-card"
                  key={w.id}
                  onClick={() => editWatch(s, w)}
                >
                  <Cover subject={s} />
                  <div>
                    <b>{s.title}</b>
                    <small>看到第 {w.progress || 0} 集</small>
                    <span>继续记录 →</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {data.watches.some(
        (w: Watch) =>
          w.precision === "day" &&
          w.finished.slice(5) === data.today.slice(5) &&
          w.finished < data.today,
      ) && (
        <div className="memory">
          <Leaf size={19} />
          <div>
            <b>那年今日</b>
            {data.watches
              .filter(
                (w: Watch) =>
                  w.precision === "day" &&
                  w.finished.slice(5) === data.today.slice(5) &&
                  w.finished < data.today,
              )
              .map((w: Watch) => (
                <p key={w.id}>
                  {w.finished}，你看完了《{subjects.get(w.subject_id)?.title}
                  》。
                </p>
              ))}
          </div>
        </div>
      )}
      <div className="section-title">
        <h2>
          我的时间线 <small>每一份喜欢都有日期</small>
        </h2>
        <div className="actions">
          <select
            aria-label="事件类型"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="all">日记与看完</option>
            <option value="status">全部状态</option>
          </select>
          <select
            aria-label="年份"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">全部时间</option>
            {years.map((y) => (
              <option key={String(y)}>{String(y)}</option>
            ))}
          </select>
        </div>
      </div>
      {events.length === 0 ? (
        <Empty action={search} />
      ) : (
        <div className="timeline">
          {events.map((event: any) => {
            const s = subjects.get(event.subject_id);
            if (!s) return null;
            const group = event.date
              ? event.precision === "year"
                ? event.date + " · 月份未定"
                : event.date.slice(0, 7).replace("-", " 年 ") + " 月"
              : "时间未记";
            const show = last !== group;
            last = group;
            return (
              <React.Fragment key={event.id}>
                {show && <h3 className="month">{group}</h3>}
                <article className="entry">
                  <div className="date-dot" />
                  <button
                    className="cover-button"
                    onClick={() => openSubject(s)}
                  >
                    <Cover subject={s} />
                  </button>
                  <div className="entry-body">
                    <div className="meta">
                      {event.date || "等待补录"}{" "}
                      <span>
                        ·{" "}
                        {event.note
                          ? "写下了感想"
                          : statuses[event.watch.status]}
                      </span>
                    </div>
                    <button
                      className="title-button"
                      onClick={() => openSubject(s)}
                    >
                      {s.title}
                    </button>
                    {event.watch && (
                      <>
                        <div className="tags">
                          {event.watch.score && (
                            <span className="score">
                              ★ {event.watch.score}.0
                            </span>
                          )}
                          {(event.watch.tags || []).map((t: string) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                        <button
                          className="text-button"
                          onClick={() => editNote(s, event.watch)}
                        >
                          ＋ 写下此刻的感想
                        </button>
                        <button
                          className="text-button"
                          onClick={() => editWatch(s, event.watch)}
                        >
                          编辑观看记录
                        </button>
                      </>
                    )}
                    {event.note &&
                      (event.note.spoiler ? (
                        <details>
                          <summary>含剧透，点击展开</summary>
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {event.note.text}
                          </Markdown>
                        </details>
                      ) : (
                        <div className="note-preview">
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {event.note.text}
                          </Markdown>
                        </div>
                      ))}
                    {event.note && (
                      <button
                        className="text-button"
                        onClick={() => editNote(s, undefined, event.note)}
                      >
                        编辑感想
                      </button>
                    )}
                  </div>
                </article>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </>
  );
}
function Empty({ action }: { action?: () => void }) {
  return (
    <div className="empty">
      <BookOpen size={38} />
      <h3>这里，留给下一个喜欢的故事。</h3>
      <p>不用写得很完整，一句话也值得留下。</p>
      {action && (
        <button className="primary" onClick={action}>
          记录第一部动画
        </button>
      )}
    </div>
  );
}
function LibraryPage({
  data,
  openSubject,
  search,
  filterIds,
  reset,
  save,
  notify,
}: any) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [tag, setTag] = useState(""),
    [year, setYear] = useState(""),
    [min, setMin] = useState(""),
    [list, setList] = useState("");
  const tags = [
    ...new Set(data.watches.flatMap((w: Watch) => w.tags || [])),
  ] as string[];
  const filtered = data.subjects.map(pretty).filter((s: Subject) => {
    const watches = data.watches.filter((w: Watch) => w.subject_id === s.id);
    return (
      (!filterIds || filterIds.includes(s.id)) &&
      s.title.toLowerCase().includes(q.toLowerCase()) &&
      (!status || watches.some((w: Watch) => w.status === status)) &&
      (!tag || watches.some((w: Watch) => w.tags?.includes(tag))) &&
      (!year || watches.some((w: Watch) => w.finished?.startsWith(year))) &&
      (!min || watches.some((w: Watch) => (w.score || 0) >= Number(min))) &&
      (!list ||
        data.lists.find((l: List) => l.id === list)?.subject_ids.includes(s.id))
    );
  });
  return (
    <>
      <Heading
        eyebrow="MY LITTLE COLLECTION"
        title="喜欢过的世界"
        description="不只是一个列表，是一路走来的心动。"
      >
        <button
          onClick={async () => {
            const title = prompt("新片单名称");
            if (title) {
              await save("lists", {
                id: uid("list"),
                title,
                description: "",
                subject_ids: [],
              });
              notify("片单已创建");
            }
          }}
        >
          ＋ 新片单
        </button>
        <button className="primary" onClick={search}>
          <Plus size={16} />
          添加作品
        </button>
      </Heading>
      <div className="filters">
        <input
          placeholder="搜索收藏的动画…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(statuses).map(([v, l]) => (
            <option value={v} key={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">全部个人标签</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input
          className="short"
          placeholder="观看年份"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <input
          className="short"
          type="number"
          min="1"
          max="10"
          placeholder="最低评分"
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <select value={list} onChange={(e) => setList(e.target.value)}>
          <option value="">全部片单</option>
          {data.lists.map((l: List) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
        {filterIds && <button onClick={reset}>清除智能筛选</button>}
      </div>
      {list && (
        <ListEditor
          list={data.lists.find((l: List) => l.id === list)}
          subjects={data.subjects}
          save={save}
        />
      )}
      <div className="poster-grid">
        {filtered.map((s: Subject) => (
          <button className="poster" key={s.id} onClick={() => openSubject(s)}>
            <Cover subject={s} />
            <b>{s.title}</b>
            <small>
              {s.air_date?.slice(0, 4) || "年份未记"} · {s.platform || "动画"}
            </small>
          </button>
        ))}
      </div>
      {filtered.length === 0 && <Empty action={search} />}
    </>
  );
}
function ListEditor({ list, subjects, save }: any) {
  return (
    <details className="panel">
      <summary>编辑片单介绍与顺序</summary>
      <form
        key={list.id}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await save("lists", {
            ...list,
            title: f.get("title"),
            description: f.get("description"),
            subject_ids: String(f.get("order"))
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          });
        }}
      >
        <label>
          名称
          <input name="title" defaultValue={list.title} required />
        </label>
        <label>
          介绍
          <textarea name="description" defaultValue={list.description} />
        </label>
        <p className="muted">
          调整下方 ID 顺序（逗号分隔）；作品详情中可加入片单。
        </p>
        <textarea name="order" defaultValue={list.subject_ids.join(",")} />
        <p>
          {list.subject_ids
            .map(
              (id: string) => subjects.find((s: Subject) => s.id === id)?.title,
            )
            .join(" → ")}
        </p>
        <button>保存片单</button>
      </form>
    </details>
  );
}
function WatchEditor({ subject, existing, today, onSave }: any) {
  const key = "shifan-watch-" + (existing?.id || subject.id);
  const [w, setW] = useState<Watch>(() => {
    try {
      const cached = localStorage.getItem(key);
      if (cached) return JSON.parse(cached);
    } catch {}
    return (
      existing || {
        id: uid("watch"),
        subject_id: subject.id,
        status: "completed",
        finished: today,
        precision: "day",
        score: null,
        progress: 0,
        tags: [],
      }
    );
  });
  const [text, setText] = useState(
      () => localStorage.getItem(key + "-text") || "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(w));
    localStorage.setItem(key + "-text", text);
  }, [key, w, text]);
  const change = (k: string, v: any) => setW({ ...w, [k]: v });
  return (
    <>
      <span className="eyebrow">A MOMENT TO REMEMBER</span>
      <h2>{existing ? "编辑观看经历" : "记下这段相遇"}</h2>
      <p>{subject.title}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(w, text);
            localStorage.removeItem(key + "-text");
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-row">
          <label>
            观看状态
            <select
              value={w.status}
              onChange={(e) => change("status", e.target.value)}
            >
              {Object.entries(statuses).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            个人评分
            <select
              value={w.score || ""}
              onChange={(e) =>
                change("score", e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">暂不评分</option>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} 分
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            时间精度
            <select
              value={w.precision}
              onChange={(e) => {
                const p = e.target.value;
                setW({
                  ...w,
                  precision: p,
                  finished:
                    p === "unknown"
                      ? ""
                      : (w.finished || today).slice(
                          0,
                          p === "year" ? 4 : p === "month" ? 7 : 10,
                        ),
                });
              }}
            >
              <option value="day">记得某一天</option>
              <option value="month">只记得月份</option>
              <option value="year">只记得年份</option>
              <option value="unknown">时间未记</option>
            </select>
          </label>
          {w.precision !== "unknown" && (
            <label>
              看完时间
              <input
                value={w.finished}
                placeholder={
                  w.precision === "year"
                    ? "2024"
                    : w.precision === "month"
                      ? "2024-04"
                      : "2024-04-30"
                }
                onChange={(e) => change("finished", e.target.value)}
                required
              />
            </label>
          )}
        </div>
        <div className="form-row">
          <label>
            开始日期（可选）
            <input
              type="date"
              value={w.started || ""}
              onChange={(e) => change("started", e.target.value)}
            />
          </label>
          <label>
            看到第几集
            <input
              type="number"
              min="0"
              value={w.progress}
              onChange={(e) => change("progress", Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          个人标签（逗号分隔）
          <input
            defaultValue={(w.tags || []).join(", ")}
            placeholder="治愈, 毕业那年, 想再看一次"
            onBlur={(e) =>
              change(
                "tags",
                e.target.value
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        {!existing && (
          <label>
            一句话感想（可选）
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="故事结束的这一刻，你在想什么？"
            />
          </label>
        )}
        <p className="muted">草稿仅保存在当前设备。只记得月份也没关系。</p>
        <p className="error">{error}</p>
        <button className="primary" disabled={busy}>
          {busy ? "保存中…" : "收进日记"}
        </button>
      </form>
    </>
  );
}
function NoteEditor({ subject, watch, existing, onSave }: any) {
  const key = "shifan-note-" + (existing?.id || watch?.id || subject.id);
  const [n, setN] = useState<Note>(() => {
    try {
      const d = localStorage.getItem(key);
      if (d) return JSON.parse(d);
    } catch {}
    return (
      existing || {
        id: uid("note"),
        subject_id: subject.id,
        watch_id: watch?.id,
        text: "",
        spoiler: false,
      }
    );
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => localStorage.setItem(key, JSON.stringify(n)), [key, n]);
  return (
    <>
      <h2>写给《{subject.title}》</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(n);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          感想 / 补记 / 喜欢的台词
          <textarea
            rows={10}
            value={n.text}
            onChange={(e) => setN({ ...n, text: e.target.value })}
            required
            placeholder="可以很长，也可以只有一句。支持 Markdown。"
          />
        </label>
        <label>
          关联单集（可选）
          <input
            value={n.episode || ""}
            onChange={(e) => setN({ ...n, episode: e.target.value })}
            placeholder="例如 12 / SP 1"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={n.spoiler}
            onChange={(e) => setN({ ...n, spoiler: e.target.checked })}
          />
          包含剧透
        </label>
        <label>
          插入图片
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (!f) return;
                const body = new FormData();
                body.set("file", f);
                const result = await api("/media", body);
                setN({
                  ...n,
                  text: n.text + "\n\n![图片](" + result.url + ")",
                });
              } catch (e: any) {
                setError(e.message);
              }
            }}
          />
        </label>
        <details>
          <summary>预览</summary>
          <Markdown remarkPlugins={[remarkGfm]}>{n.text}</Markdown>
        </details>
        <p className="error">{error}</p>
        <button className="primary" disabled={busy}>
          保存这段心情
        </button>
      </form>
    </>
  );
}
function SubjectDetail({
  subject,
  state,
  save,
  editWatch,
  editNote,
  remove,
  notify,
  ai,
}: any) {
  const live = useQuery<State>({
    queryKey: ["state"],
    queryFn: () => api("/state"),
  });
  const qc = useQueryClient();
  state = live.data || state;
  subject =
    state.subjects.find((item: Subject) => item.id === subject.id) || subject;
  const s = pretty(subject);
  return (
    <>
      <div className="detail-head">
        <Cover subject={s} />
        <div>
          <span className="eyebrow">MY ANIME MEMORY</span>
          <h2>{s.title}</h2>
          <p>{s.original_title}</p>
          <p className="muted">
            {s.air_date || "播出日期未知"} · {s.platform || "动画"} ·{" "}
            {s.episodes || "?"} 集
          </p>
          <p>Bangumi ★ {s.rating?.score || "暂无"}</p>
          {s.bgm_id && (
            <a
              href={"https://bgm.tv/subject/" + s.bgm_id}
              target="_blank"
              rel="noreferrer"
            >
              查看 Bangumi ↗
            </a>
          )}
        </div>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => editWatch(s)}>
          ＋ 记录观看 / 重看
        </button>
        <button onClick={() => editNote(s)}>写一段感想</button>
        <button onClick={() => ai("translate", s.summary || "")}>
          翻译简介
        </button>
      </div>
      <p className="synopsis">{s.summary || "暂时没有简介"}</p>
      {s.summary_translation && (
        <section className="note-block">
          <small>简介译文 · 原文保留</small>
          <p>{s.summary_translation}</p>
        </section>
      )}
      <div className="tags">
        {s.tags?.map((t: string) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <details>
        <summary>作品资料修订与刷新</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await save("subjects", {
              ...subject,
              overrides: {
                ...subject.overrides,
                title: String(f.get("title")),
                summary: String(f.get("summary")),
              },
            });
            notify("资料修订已保存，重新打开查看");
          }}
        >
          <input name="title" defaultValue={s.title} required />
          <textarea name="summary" rows={6} defaultValue={s.summary} />
          <button>保存修订</button>
        </form>
        {s.bgm_id && (
          <button
            onClick={async () => {
              try {
                await api(
                  "/bangumi/subjects/" + s.bgm_id + "?refresh=true",
                  {},
                );
                await qc.invalidateQueries({ queryKey: ["state"] });
                notify("资料已刷新，重新打开查看");
              } catch (e: any) {
                notify(e.message);
              }
            }}
          >
            刷新 Bangumi 资料
          </button>
        )}
      </details>
      <details>
        <summary>制作信息</summary>
        <pre>{JSON.stringify(s.raw?.infobox || [], null, 2)}</pre>
      </details>
      <h3>观看经历</h3>
      {state.watches
        .filter((w: Watch) => w.subject_id === s.id)
        .map((w: Watch) => (
          <div className="list-row" key={w.id}>
            <span>
              {w.finished || "时间未记"} · {statuses[w.status]} ·{" "}
              {w.score || "未评"} 分
            </span>
            <button onClick={() => editWatch(s, w)}>编辑 / 补日期</button>
            <button onClick={() => editNote(s, w)}>补记</button>
            <button onClick={() => remove("watches", w.id)}>删除</button>
          </div>
        ))}
      <h3>留下的文字</h3>
      {state.notes
        .filter((n: Note) => n.subject_id === s.id)
        .map((n: Note) => (
          <article className="note-block" key={n.id}>
            <small>
              {n.created_at?.slice(0, 10)}{" "}
              {n.episode && "· 第 " + n.episode + " 集"}
            </small>
            {n.spoiler ? (
              <details>
                <summary>含剧透感想</summary>
                <Markdown>{n.text}</Markdown>
              </details>
            ) : (
              <Markdown remarkPlugins={[remarkGfm]}>{n.text}</Markdown>
            )}
            <div className="actions">
              <button onClick={() => editNote(s, undefined, n)}>编辑</button>
              <button onClick={() => ai("polish", n.text)}>整理感想</button>
              <button onClick={() => remove("notes", n.id)}>删除</button>
            </div>
          </article>
        ))}
      <h3>加入片单</h3>
      {state.lists.map((l: List) => (
        <label className="check" key={l.id}>
          <input
            type="checkbox"
            checked={l.subject_ids.includes(s.id)}
            onChange={async (e) => {
              await save("lists", {
                ...l,
                subject_ids: e.target.checked
                  ? [...l.subject_ids, s.id]
                  : l.subject_ids.filter((id) => id !== s.id),
              });
              notify("片单已更新，重新打开查看");
            }}
          />
          {l.title}
        </label>
      ))}
      {!s.bgm_id && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const bgm_id = Number(
                new FormData(e.currentTarget).get("bgm_id"),
              );
              await api("/bangumi/link", { local_id: s.id, bgm_id });
              location.reload();
            } catch (error: any) {
              notify(error.message);
            }
          }}
        >
          <label>
            关联 Bangumi ID
            <input name="bgm_id" type="number" min="1" required />
          </label>
          <button>关联并合并资料</button>
        </form>
      )}
      <button className="danger" onClick={() => remove("subjects", s.id)}>
        删除作品及关联记录
      </button>
    </>
  );
}
function SearchDialog({ onAdd }: any) {
  const [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [results, setResults] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function search(next = 0) {
    setBusy(true);
    try {
      const r = await api(
        "/bangumi/search?q=" + encodeURIComponent(q) + "&offset=" + next,
      );
      setResults(r.data || []);
      setOffset(next);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <span className="eyebrow">FIND YOUR NEXT MEMORY</span>
      <h2>你想记下哪一部？</h2>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input
          placeholder="动画名称、Bangumi ID 或链接"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          required
          autoFocus
        />
        <button className="primary" disabled={busy}>
          <Search size={17} />
          {busy ? "搜索中" : "搜索"}
        </button>
      </form>
      <p className="error">{error}</p>
      {results.map((r) => (
        <div className="search-result" key={r.id}>
          <div>
            <b>{r.name_cn || r.name}</b>
            <p>{r.summary?.slice(0, 120)}</p>
          </div>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await api("/bangumi/subjects/" + r.id, {});
                onAdd(s);
              } catch (e: any) {
                setError(e.message);
                setBusy(false);
              }
            }}
          >
            记录
          </button>
        </div>
      ))}
      {results.length > 0 && (
        <div className="actions">
          <button
            disabled={offset === 0 || busy}
            onClick={() => search(Math.max(0, offset - 12))}
          >
            上一页
          </button>
          <button
            disabled={results.length < 12 || busy}
            onClick={() => search(offset + 12)}
          >
            下一页
          </button>
        </div>
      )}
      <details>
        <summary>找不到？手动添加作品</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const f = new FormData(e.currentTarget);
              const s = await api(
                "/records/subjects/" + uid("subject"),
                {
                  title: f.get("title"),
                  summary: f.get("summary"),
                  cover: "",
                  tags: [],
                },
                "PUT",
              );
              onAdd(s);
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          <label>
            名称
            <input name="title" required />
          </label>
          <label>
            简介
            <textarea name="summary" />
          </label>
          <button>添加并记录</button>
        </form>
      </details>
    </>
  );
}
function Review({ data, ai, share }: any) {
  const [year, setYear] = useState(data.today.slice(0, 4));
  const result = useQuery({
    queryKey: ["stats", year, data.watches],
    queryFn: () => api("/statistics?year=" + year),
  });
  const [dimension, setDimension] = useState("months");
  return (
    <>
      <Heading
        eyebrow="A YEAR IN STORIES"
        title="时光里的动画记忆"
        description="回头看，原来已经一起走了这么远。"
      >
        <button onClick={share}>
          <Share2 size={16} />
          生成回顾图片
        </button>
        <button onClick={ai}>
          <Sparkles size={16} />
          写一份年度回顾
        </button>
      </Heading>
      <div className="actions">
        <input
          className="short"
          aria-label="回顾年份"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="2026"
        />
        <button onClick={() => setYear("")}>所有年份</button>
      </div>
      {result.data && (
        <>
          <div className="summary-strip">
            <div>
              <b>{result.data.completions}</b>
              <span>次看完</span>
            </div>
            <div>
              <b>{result.data.unique}</b>
              <span>部不同的作品</span>
            </div>
            <div>
              <b>{result.data.completions - result.data.unique}</b>
              <span>次再次相遇</span>
            </div>
            <div>
              <b>{result.data.unknown_dates}</b>
              <span>条时间待补录</span>
            </div>
          </div>
          <section className="panel">
            <div className="section-title">
              <h2>喜欢的形状</h2>
              <select
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
              >
                {Object.entries({
                  months: "按观看月份",
                  scores: "按个人评分",
                  tags: "按个人标签",
                  types: "按作品类型",
                  air_years: "按播出年份",
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <Suspense fallback={<p>正在整理图表…</p>}>
              <Charts data={result.data[dimension]} />
            </Suspense>
            <p className="muted">
              月份分布按看完时间统计，重看单独计次；不包含月份未知的记录。
            </p>
          </section>
        </>
      )}
    </>
  );
}
async function waitJob(id: string, onUpdate?: (j: any) => void) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const j = await api("/jobs/" + id);
    onUpdate?.(j);
    if (j.status === "done") return j.result;
    if (j.status === "failed") throw Error(j.error);
  }
}
function AI({ initialTask, initialText, state, onSave, onFound }: any) {
  const profiles = useQuery({
    queryKey: ["models"],
    queryFn: () => api("/models"),
  });
  const [task, setTask] = useState(initialTask),
    [text, setText] = useState(initialText),
    [profile, setProfile] = useState(
      () => localStorage.getItem("shifan-model-" + initialTask) || "",
    ),
    [year, setYear] = useState(state.today.slice(0, 4)),
    [keyword, setKeyword] = useState(""),
    [spoilers, setSpoilers] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState("");
  return (
    <>
      <span className="eyebrow">A LITTLE HELP WITH WORDS</span>
      <h2>灵感助手</h2>
      <p className="muted">
        你的感受由你决定。生成结果只作候选，不会自动改写日记。
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setResult(null);
          localStorage.setItem("shifan-model-" + task, profile);
          try {
            const j = await api("/jobs", {
              kind: "ai",
              params: {
                task,
                text,
                profile_id: profile,
                year: task === "year" ? year : "",
                keyword,
                include_spoilers: spoilers,
              },
            });
            setResult(await waitJob(j.id));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-row">
          <label>
            任务
            <select
              value={task}
              onChange={(e) => {
                setTask(e.target.value);
                setProfile(
                  localStorage.getItem("shifan-model-" + e.target.value) || "",
                );
                setResult(null);
              }}
            >
              {Object.entries(taskNames).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            使用模型
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              required
            >
              <option value="">请选择配置</option>
              {profiles.data?.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </select>
          </label>
        </div>
        {task === "year" && (
          <label>
            回顾年份
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
            />
          </label>
        )}
        {task === "recommend" && (
          <label>
            候选搜索词（留空使用想看片单）
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </label>
        )}
        <label>
          {task === "recommend" ? "现在的心情与偏好" : "文字内容 / 搜索要求"}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
          />
        </label>
        {["year", "recommend"].includes(task) && (
          <>
            <p className="muted">
              将发送{task === "year" ? year + " 年" : "全部"}
              观看记录、作品标题及相关感想给所选模型服务商。最多约八万字符，超出时请缩小范围。
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={spoilers}
                onChange={(e) => setSpoilers(e.target.checked)}
              />
              包含标记剧透的感想
            </label>
          </>
        )}
        <p className="error">{error}</p>
        <button className="primary" disabled={busy}>
          {busy ? "正在生成，请稍候…" : "生成候选结果"}
        </button>
      </form>
      {result && (
        <div className="ai-result">
          <Markdown>{result.text}</Markdown>
          {result.subject_ids ? (
            <button onClick={() => onFound(result.subject_ids)}>
              查看这些作品
            </button>
          ) : (
            <>
              <textarea
                rows={8}
                value={result.text}
                onChange={(e) => setResult({ ...result, text: e.target.value })}
              />
              <div className="actions">
                <button
                  onClick={() => navigator.clipboard.writeText(result.text)}
                >
                  复制
                </button>
                {["polish", "translate"].includes(task) && (
                  <button
                    onClick={async () => {
                      try {
                        await onSave(result.text, task, text);
                        setError("已保存为独立感想，原文保留");
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    {task === "translate"
                      ? "接受并保存译文"
                      : "接受并另存为感想"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
function Share({ state }: any) {
  const [selected, setSelected] = useState<string[]>(
      state.watches
        .filter((w: Watch) => w.status === "completed")
        .map((w: Watch) => w.id),
    ),
    [template, setTemplate] = useState("timeline"),
    [year, setYear] = useState(""),
    [title, setTitle] = useState(""),
    [nickname, setNickname] = useState(""),
    [notes, setNotes] = useState(false),
    [scores, setScores] = useState(true),
    [spoilers, setSpoilers] = useState(false),
    [images, setImages] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <span className="eyebrow">SHARE A PIECE OF YOUR STORY</span>
      <h2>把记忆装进一张图片</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setImages([]);
          try {
            const j = await api("/jobs", {
              kind: "share",
              params: {
                template,
                title,
                nickname,
                watch_ids: selected,
                include_notes: notes,
                include_scores: scores,
                include_spoilers: spoilers,
              },
            });
            setImages((await waitJob(j.id)).images);
            setError("");
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <select value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="timeline">时间线</option>
          <option value="year">年度回顾</option>
          <option value="subject">单作品感想</option>
        </select>
        <div className="form-row">
          <label>
            标题
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="留空使用模板标题"
            />
          </label>
          <label>
            分享署名（可选）
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
        </div>
        <label>
          按年份选择
          <input
            placeholder="例如 2024"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setSelected(
                state.watches
                  .filter((w: Watch) => w.finished.startsWith(e.target.value))
                  .map((w: Watch) => w.id),
              );
            }}
          />
        </label>
        <div className="selection">
          {state.watches
            .filter((w: Watch) => !year || w.finished.startsWith(year))
            .map((w: Watch) => (
              <label className="check" key={w.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(w.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, w.id]
                        : selected.filter((id) => id !== w.id),
                    )
                  }
                />
                {
                  state.subjects.find((s: Subject) => s.id === w.subject_id)
                    ?.title
                }{" "}
                · {w.finished || "时间未记"}
              </label>
            ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={scores}
            onChange={(e) => setScores(e.target.checked)}
          />
          显示个人评分
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={notes}
            onChange={(e) => setNotes(e.target.checked)}
          />
          包含私人感想
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={spoilers}
            onChange={(e) => setSpoilers(e.target.checked)}
          />
          允许包含剧透
        </label>
        <p className="error">{error}</p>
        <button className="primary" disabled={busy || !selected.length}>
          {busy ? "正在排版…" : "生成预览"}
        </button>
      </form>
      {images.map((url, i) => (
        <div className="share-preview" key={url}>
          <img src={url} alt={"分享预览 " + (i + 1)} />
          <a
            className="button primary"
            href={url}
            download={"拾番-" + (i + 1) + ".png"}
          >
            <Download size={16} />
            下载第 {i + 1} 张
          </a>
        </div>
      ))}
    </>
  );
}
function SettingsPage({ notify, refreshed }: any) {
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => api("/models"),
  });
  const prompts = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api("/prompts"),
  });
  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: () => api("/backups"),
  });
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [selected, setSelected] = useState<number[]>([]);
  async function action(fn: () => Promise<any>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="MAKE YOURSELF AT HOME"
        title="让这里，更像你"
        description="连接资料与灵感，也照顾好每一份记忆。"
      />
      <p role="alert" className="error">
        {error}
      </p>
      <section className="panel">
        <h2>模型服务</h2>
        <p className="muted">
          支持 OpenAI、DeepSeek 和 OpenAI 兼容接口。地址应包含 /v1 等接口前缀。
        </p>
        {models.data?.map((p: any) => (
          <div className="list-row" key={p.id}>
            <span>
              {p.name}
              <small>{p.model} · 密钥已配置</small>
            </span>
            <button onClick={() => setEditing(p)}>编辑</button>
            <button
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const j = await api("/jobs", {
                    kind: "ai",
                    params: {
                      task: "translate",
                      text: "こんにちは",
                      profile_id: p.id,
                    },
                  });
                  const r = await waitJob(j.id);
                  notify("连接成功：" + r.text);
                })
              }
            >
              测试
            </button>
            <button
              onClick={() =>
                action(async () => {
                  await api("/models/" + p.id, undefined, "DELETE");
                  qc.invalidateQueries({ queryKey: ["models"] });
                })
              }
            >
              删除
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setEditing({
              id: uid("profile"),
              name: "",
              base_url: "https://api.deepseek.com/v1",
              model: "deepseek-chat",
              timeout: 60,
              max_tokens: 2048,
            })
          }
        >
          ＋ 添加模型配置
        </button>
        {editing && (
          <form
            key={editing.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              action(async () => {
                await api(
                  "/models/" + editing.id,
                  {
                    ...f,
                    timeout: Number(f.timeout),
                    max_tokens: Number(f.max_tokens),
                  },
                  "PUT",
                );
                setEditing(null);
                qc.invalidateQueries({ queryKey: ["models"] });
                notify("模型已保存");
              });
            }}
          >
            <label>
              配置名称
              <input name="name" defaultValue={editing.name} required />
            </label>
            <label>
              Base URL
              <input name="base_url" defaultValue={editing.base_url} required />
            </label>
            <label>
              模型名称
              <input name="model" defaultValue={editing.model} required />
            </label>
            <label>
              API Key
              <input
                name="api_key"
                type="password"
                placeholder={editing.has_key ? "留空保留原密钥" : "填写密钥"}
                autoComplete="off"
              />
            </label>
            <div className="form-row">
              <label>
                超时（秒）
                <input
                  name="timeout"
                  type="number"
                  min="10"
                  max="180"
                  defaultValue={editing.timeout || 60}
                />
              </label>
              <label>
                最大输出 Token
                <input
                  name="max_tokens"
                  type="number"
                  min="128"
                  max="8192"
                  defaultValue={editing.max_tokens || 2048}
                />
              </label>
            </div>
            <button className="primary" disabled={busy}>
              保存配置
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>任务提示词</h2>
        <p className="muted">
          支持 {"{{text}}"} 和 {"{{context}}"}{" "}
          变量。可在灵感助手中试运行；每个任务会记住此设备上次选择的模型。
        </p>
        {prompts.data &&
          Object.entries(prompts.data).map(([name, p]: any) => (
            <details key={name}>
              <summary>{taskNames[name]}</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  action(async () => {
                    await api(
                      "/prompts/" + name,
                      { text: f.get("text") },
                      "PUT",
                    );
                    qc.invalidateQueries({ queryKey: ["prompts"] });
                    notify("提示词已保存");
                  });
                }}
              >
                <textarea
                  key={p.text}
                  name="text"
                  rows={6}
                  defaultValue={p.text}
                />
                <button disabled={busy}>保存提示词</button>
                <button
                  type="button"
                  onClick={() =>
                    action(async () => {
                      await api("/prompts/" + name, { text: p.default }, "PUT");
                      qc.invalidateQueries({ queryKey: ["prompts"] });
                      notify("已恢复默认，请重新展开查看");
                    })
                  }
                >
                  恢复默认
                </button>
              </form>
            </details>
          ))}
      </section>
      <section className="panel">
        <h2>Bangumi 资料与收藏</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const token = new FormData(form).get("token");
            action(async () => {
              await api("/bangumi/config", { token }, "PUT");
              form.reset();
              notify("Bangumi 密钥已保存");
            });
          }}
        >
          <label>
            Bangumi Access Token
            <input
              name="token"
              type="password"
              autoComplete="off"
              placeholder="仅保存在服务器"
            />
          </label>
          <button disabled={busy}>保存密钥</button>
        </form>
        <hr />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const username = new FormData(e.currentTarget).get("username");
            action(async () => {
              const j = await api("/jobs", {
                kind: "import-preview",
                params: { username },
              });
              const result = await waitJob(j.id);
              setPreview({ id: j.id, ...result });
              setSelected(
                result.items
                  .filter((i: any) => !i.conflict)
                  .map((i: any) => i.subject_id),
              );
            });
          }}
        >
          <label>
            导入收藏的用户名
            <input name="username" required />
          </label>
          <button disabled={busy}>{busy ? "处理中…" : "获取导入预览"}</button>
        </form>
        {preview && (
          <>
            <p className="muted">
              默认跳过已有记录。手动选中冲突条目会另建导入经历；已有导入记录不会覆盖。收藏更新时间不作为看完时间。
            </p>
            <div className="selection">
              {preview.items.map((i: any) => (
                <label className="check" key={i.subject_id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(i.subject_id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, i.subject_id]
                          : selected.filter((s) => s !== i.subject_id),
                      )
                    }
                  />
                  {i.title} {i.conflict ? "（已有记录）" : ""}
                </label>
              ))}
            </div>
            <button
              disabled={busy || !selected.length}
              onClick={() =>
                action(async () => {
                  const j = await api("/jobs", {
                    kind: "import-apply",
                    params: { preview_id: preview.id, selected },
                  });
                  notify((await waitJob(j.id)).text);
                  setPreview(null);
                  await refreshed();
                })
              }
            >
              导入选中条目（{selected.length}）
            </button>
          </>
        )}
      </section>
      <section className="panel">
        <h2>备份与迁移</h2>
        <p className="muted">
          完整备份包含作品、观看经历、感想、片单和图片，不包含密钥。每天自动备份，保留最近七份。
        </p>
        <div className="actions">
          {[
            ["zip", "完整 ZIP"],
            ["json", "JSON"],
            ["csv", "CSV"],
            ["markdown", "Markdown"],
          ].map(([v, l]) => (
            <a className="button" key={v} href={"/api/v1/export/" + v} download>
              <Download size={15} />
              {l}
            </a>
          ))}
          <button
            onClick={() =>
              action(async () => {
                await api("/backup", {});
                qc.invalidateQueries({ queryKey: ["backups"] });
                notify("备份已创建");
              })
            }
          >
            立即备份
          </button>
        </div>
        <details>
          <summary>服务器备份</summary>
          {backups.data?.map((b: string) => (
            <p key={b}>
              <a href={"/api/v1/backups/" + b}>{b}</a>
            </p>
          ))}
        </details>
        <label>
          从 ZIP 恢复（整体替换；先自动备份）
          <input
            type="file"
            accept=".zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (
                f &&
                confirm("确定用备份整体替换当前日记？恢复前会自动备份。")
              )
                action(async () => {
                  const body = new FormData();
                  body.set("file", f);
                  await api("/restore", body);
                  await refreshed();
                  notify("已恢复日记");
                });
            }}
          />
        </label>
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

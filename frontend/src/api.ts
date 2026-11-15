export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = "请求失败";
    try {
      const j = await r.json();
      detail =
        typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    throw new Error(r.status === 401 ? "请登录" : detail);
  }
  return r.json();
}
export const uid = (prefix: string) => prefix + "-" + crypto.randomUUID();
export const statuses: Record<string, string> = {
  wish: "想看",
  watching: "在看",
  completed: "看完",
  paused: "搁置",
  dropped: "弃番",
};
export interface Subject {
  id: string;
  title: string;
  original_title?: string;
  summary?: string;
  summary_translation?: string;
  cover?: string;
  bgm_id?: number;
  air_date?: string;
  episodes?: number;
  platform?: string;
  tags?: string[];
  rating?: { score?: number };
  raw?: any;
  overrides?: Record<string, string>;
  revision?: number;
}
export interface Watch {
  id: string;
  subject_id: string;
  status: string;
  finished: string;
  precision: string;
  score: number | null;
  progress: number;
  tags: string[];
  started?: string;
  revision?: number;
  created_at?: string;
}
export interface Note {
  id: string;
  subject_id: string;
  watch_id?: string;
  text: string;
  spoiler: boolean;
  episode?: string;
  created_at?: string;
  revision?: number;
}
export interface List {
  id: string;
  title: string;
  description: string;
  subject_ids: string[];
  revision?: number;
}
export interface State {
  subjects: Subject[];
  watches: Watch[];
  notes: Note[];
  lists: List[];
  today: string;
}

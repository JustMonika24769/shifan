import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());
describe("authenticated API client", () => {
  it("turns expired authentication into the login state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "expired" }), { status: 401 }),
        ),
    );
    await expect(api("/state")).rejects.toThrow("请登录");
  });
  it("preserves conflict explanations so the editor can keep its draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: "记录已在其他页面修改，请刷新后重试" }),
            { status: 422 },
          ),
        ),
    );
    await expect(
      api("/records/watches/watch-test", { revision: 1 }, "PUT"),
    ).rejects.toThrow("请刷新后重试");
  });
  it("lets the browser set multipart boundaries for uploaded images", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ url: "/media/example.jpg" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const form = new FormData();
    form.set("file", new Blob(["image"]), "example.jpg");
    await api("/media", form);
    const options = fetcher.mock.calls[0][1];
    expect(options.headers).toEqual({});
    expect(options.body).toBe(form);
  });
});

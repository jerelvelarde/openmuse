import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createAuth } from "../apps/server/src/auth.ts";
import { ComputerService } from "../apps/server/src/computer.ts";
import { computerTools } from "../apps/server/src/computer-tools.ts";
import { createStore } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";
import { config, fixture, ok } from "./helpers/computer.ts";

test("export_computer_pdf returns file metadata without a signed content link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-computer-tools-"));
  const db = await createStore();
  try {
    const document = await PDFDocument.create();
    document.addPage();
    const pdf = await document.save();
    const f = fixture({
      command: async () =>
        ok(
          JSON.stringify({
            path: "/workspace/report.pdf",
            base64: Buffer.from(pdf).toString("base64"),
          }),
        ),
    });
    const local = { ...config, dataDir: directory };
    const files = new Files(db, local, await createAuth(db, local));
    const tools = computerTools(new ComputerService(db, local, f.runner), files, "owner", "test");
    const exportPdf = tools.find((tool) => tool.name === "export_computer_pdf");
    assert.ok(exportPdf?.execute);
    // The tool list is a union of schemas, so its execute argument type narrows to never.
    const result = await exportPdf.execute({ path: "/workspace/report.pdf" } as never);
    assert.ok(!JSON.stringify(result).includes("signature="));
    assert.ok(!JSON.stringify(result).includes("/content"));
    const { id, ...metadata } = result as { id: string };
    assert.deepEqual(metadata, { name: "report.pdf", size: pdf.length, pageCount: 1, fields: [] });
    assert.equal((await files.get("owner", id)).source, "Computer: /workspace/report.pdf");
    // Owner-authenticated routes still receive a signed link for the saved file.
    const [listed] = await files.list("owner");
    assert.equal(listed?.id, id);
    assert.match(listed?.url ?? "", /\/api\/files\/.+\/content\?.*signature=/);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

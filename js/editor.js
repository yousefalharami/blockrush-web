// Build Editor: design a target build and export it in the builds/*.json format.
import { t, buildName } from "./i18n.js";
import { HEX, empty, toLayers, parseLayers, paletteOf, mountBuilder } from "./voxel.js";

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function mountEditor(app, { builds, header, onExit }) {
  let vox = empty(), meta = { id: "", en: "" };

  const json = () => JSON.stringify({ id: meta.id || slug(meta.en) || "untitled",
    name: { en: meta.en }, layers: toLayers(vox) }, null, 2);

  function render() {
    app.innerHTML = `${header(`<button class="chip ghost" id="back">←</button>`)}
    <div class="stage">
      <div class="phase">${t("editor")}</div>
      <div class="row">
        <select id="load"><option value="">${t("edLoad")}</option>
          ${[...builds.values()].map(b => `<option value="${b.id}">${esc(buildName(b))}</option>`).join("")}</select>
        <button class="btn ghost" id="new">${t("edNew")}</button>
      </div>
      <div class="form3">
        <label class="field"><span>${t("edNameEn")}</span><input id="en" value="${esc(meta.en)}"></label>
        <label class="field"><span>${t("edId")}</span><input id="id" dir="ltr" value="${esc(meta.id)}" placeholder="${esc(slug(meta.en))}"></label>
      </div>
      <div id="bld"></div>
      <p class="hint" id="count"></p>
      <div class="row">
        <button class="btn" id="dl">${t("edExport")}</button>
        <button class="btn ghost" id="cp">${t("edCopy")}</button>
      </div>
      <textarea id="out" dir="ltr" spellcheck="false" rows="10"></textarea>
      <div class="row"><button class="btn ghost" id="imp">${t("edImport")}</button></div>
      <p class="hint small">${t("edManifest")}</p>
    </div>`;
    const $ = s => app.querySelector(s);
    const sync = () => {
      $("#out").value = json();
      $("#count").textContent = t("edBlocks", { n: vox.filter(Boolean).length });
      $("#id").placeholder = slug(meta.en);
    };
    mountBuilder($("#bld"), vox, paletteOf(Object.keys(HEX)), { t, onChange: sync });
    for (const k of ["en", "id"]) $("#" + k).oninput = e => { meta[k] = e.target.value.trim(); sync(); };
    $("#back").onclick = onExit;
    $("#new").onclick = () => { vox = empty(); meta = { id: "", en: "" }; render(); };
    $("#load").onchange = e => {
      const b = builds.get(e.target.value); if (!b) return;
      vox = parseLayers(b.layers); meta = { id: b.id, en: b.name.en || "" }; render();
    };
    $("#dl").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json() + "\n"], { type: "application/json" }));
      a.download = `${meta.id || slug(meta.en) || "untitled"}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("#cp").onclick = async e => {
      try { await navigator.clipboard.writeText(json()); e.target.textContent = t("edCopied"); }
      catch { $("#out").select(); }
    };
    $("#imp").onclick = () => {
      try {
        const b = JSON.parse($("#out").value);
        vox = parseLayers(b.layers); meta = { id: b.id || "", en: b.name?.en || "" }; render();
      } catch { $("#out").classList.add("bad"); }
    };
    sync();
  }
  render();
}

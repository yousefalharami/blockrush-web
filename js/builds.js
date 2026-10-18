import { parseLayers, tierOf } from "./voxel.js";

let cache = null;

// Returns Map id → { id, name:{en}, layers, vox, tier }
export async function loadBuilds() {
  if (cache) return cache;
  const ids = await (await fetch("builds/index.json")).json();
  const list = await Promise.all(ids.map(id => fetch(`builds/${id}.json`).then(r => r.json())));
  cache = new Map(list.map(b => { const vox = parseLayers(b.layers); return [b.id, { ...b, vox, tier: tierOf(vox) }]; }));
  return cache;
}

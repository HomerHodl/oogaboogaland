import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as protocol from "../src/protocol.js";
import { sfuClient } from "../src/sfu.js";

const zones = ["dsb-outside", "dsb-studio", "dsb-maxis", "dsb-without-rulers", "dsb-proof-of-ink", "dsb-big-bitcoin", "dsb-meme-factory", "dsb-stackchain", "dsb-svrn"];
test("every DSB venue isolates voice from other venues, hub and Bifrost", () => {
  const player = (id, zone) => ({ id, zone, body: `ooga-${id}`, voice: { sub: "receive", track: "mic" } });
  for (const zone of zones) {
    assert.deepEqual(protocol.parseClientMessage(JSON.stringify({ t: "zone", name: zone })), { t: "zone", name: zone });
    const peers = [player(1, zone), player(2, zone), ...zones.filter(z => z !== zone).map((z, i) => player(i + 3, z)), player(20, "outside"), player(21, "scene-bifrost")];
    assert.deepEqual(protocol.voicePeers(peers).get(1), [2]);
    peers[0].zone = "scene-bifrost";
    assert.deepEqual(protocol.voicePeers(peers).get(1), [21]);
    peers[0].body = null;
    assert.deepEqual(protocol.voicePeers(peers).get(1), []);
  }
});

// Execute the real room methods with a minimal Cloudflare host, sockets and SFU mocked.
const roomClass = () => {
  const source = readFileSync(new URL("../src/room.js", import.meta.url), "utf8")
    .replace(/import\s+[\s\S]*?from\s+"[^"]+";/g, "")
    .replace("export class Room", "class Room") + "\nglobalThis.Room = Room;";
  const context = { ...protocol, DurableObject: class {}, sfuClient, CAST_ROWS: [{ handle: "YellowBrokeIt", github_login: "YellowBrokeIt" }], Date, Map, Set, setTimeout, clearTimeout };
  runInNewContext(source, context);
  return context.Room;
};
test("room broadcasts DSB zone changes, persists them and keeps ownership enforcement", () => {
  const Room = roomClass(), room = Object.create(Room.prototype), sent = [];
  room.players = new Map(); room.voiceSig = new Map();
  let attachment;
  const ws = { deserializeAttachment: () => ({ id: 1 }), serializeAttachment: value => { attachment = value; }, send: text => sent.push(JSON.parse(text)) };
  const player = room.record(ws, { id: 1, login: "YellowBrokeIt", display: "Yellow", body: "YellowBrokeIt", x: -45, y: 40, z: -43, yaw: 0 });
  room.players.set(1, player);
  room.webSocketMessage(ws, JSON.stringify({ t: "zone", name: "dsb-svrn" }));
  assert.equal(room.view(player).zone, "dsb-svrn");
  assert.equal(attachment.zone, "dsb-svrn");
  assert.ok(sent.some(m => m.t === "zone" && m.id === 1 && m.name === "dsb-svrn"));
  room.webSocketMessage(ws, JSON.stringify({ t: "body", name: "someone-else" }));
  assert.equal(player.body, null);
  assert.ok(sent.some(m => m.t === "release" && m.reason === "not-yours"));
  room.webSocketMessage(ws, JSON.stringify({ t: "zone", name: "scene-bifrost" }));
  assert.equal(room.view(player).zone, "scene-bifrost");
});

test("SFU stays unavailable without secrets and uses bounded upstream calls with mocked transport", async () => {
  assert.equal(sfuClient({}), null);
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ sessionId: "fixture" }) }; };
  try {
    const client = sfuClient({ REALTIME_APP_ID: "fixture-app", REALTIME_SECRET: "fixture-only" });
    await client.newSession(); await client.newTracks("fixture", { tracks: [] });
    await client.renegotiate("fixture", "fixture-sdp"); await client.closeTracks("fixture", ["0"]);
    assert.deepEqual(calls.map(c => c.options.method), ["POST", "POST", "PUT", "PUT"]);
    assert.ok(calls.every(c => c.url.startsWith("https://rtc.live.cloudflare.com/v1/apps/fixture-app/sessions/")));
    assert.equal(JSON.parse(calls[3].options.body).force, true);
  } finally { globalThis.fetch = original; }
});

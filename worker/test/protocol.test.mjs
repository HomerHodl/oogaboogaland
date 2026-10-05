// Pure checks on the room's wire format and limits: no Durable Object, no sockets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUND_XZ, MESSAGE_MAX, MOVE_HZ, parseClientMessage, playerFromHeaders, spawnPoint, takeToken } from "../src/protocol.js";

test("poses inside the bounds are accepted, rounded and their yaw wrapped", () => {
  const m = parseClientMessage(JSON.stringify({ t: "pose", x: 1.23456, y: -7, z: 3, yaw: 7 }));
  assert.equal(m.t, "pose");
  assert.equal(m.x, 1.235);
  assert.ok(Math.abs(m.yaw - (7 - 2 * Math.PI)) < 1e-3);
});

test("poses out of bounds or not numbers are ignored, not fatal", () => {
  for (const bad of [{ x: BOUND_XZ + 1, y: 0, z: 0, yaw: 0 }, { x: 0, y: 500, z: 0, yaw: 0 }, { x: "1", y: 0, z: 0, yaw: 0 }, { x: 0, y: 0, z: 0 }]) {
    assert.equal(parseClientMessage(JSON.stringify({ t: "pose", ...bad })), null, JSON.stringify(bad));
  }
});

test("a body is an Ooga name or null; anything else is ignored", () => {
  assert.deepEqual(parseClientMessage('{"t":"body","name":"w-s-bitcoin"}'), { t: "body", name: "w-s-bitcoin" });
  assert.deepEqual(parseClientMessage('{"t":"body","name":null}'), { t: "body", name: null });
  assert.equal(parseClientMessage('{"t":"body","name":"<b>"}'), null);
  assert.equal(parseClientMessage('{"t":"body","name":""}'), null);
});

test("unknown types are ignored; unreadable or oversized frames close the socket", () => {
  assert.equal(parseClientMessage('{"t":"teleport","id":1}'), null);
  assert.equal(parseClientMessage("{nope"), false);
  assert.equal(parseClientMessage("[1,2]"), false);
  assert.equal(parseClientMessage(" ".repeat(MESSAGE_MAX + 1)), false);
  assert.equal(parseClientMessage(undefined), false);
});

test("the move bucket allows MOVE_HZ a second and refills with time", () => {
  const b = { tokens: MOVE_HZ, at: 0 };
  let spent = 0;
  for (let i = 0; i < 100; i++) if (takeToken(b, MOVE_HZ, 0)) spent++;
  assert.equal(spent, MOVE_HZ);
  assert.ok(!takeToken(b, MOVE_HZ, 10));
  assert.ok(takeToken(b, MOVE_HZ, 60));
});

test("spawn slots ring the pile, eight apart, facing it", () => {
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const s = spawnPoint(i);
    assert.ok(Math.abs(Math.hypot(s.x, s.z) - 3.5) < 1e-2);
    seen.add(`${s.x},${s.z}`);
  }
  assert.equal(seen.size, 8);
  assert.deepEqual(spawnPoint(8), spawnPoint(0));
});

test("identity comes only from the Worker's headers, all or nothing", () => {
  const h = (o) => new Headers(o);
  assert.deepEqual(playerFromHeaders(h({ "x-player-id": "42", "x-player-login": "ooga" })), { id: 42, login: "ooga", display: "ooga", contributor: false });
  assert.equal(playerFromHeaders(h({ "x-player-id": "42", "x-player-login": "ooga", "x-player-contributor": "1" })).contributor, true);
  assert.equal(playerFromHeaders(h({ "x-player-login": "ooga" })), null);
  assert.equal(playerFromHeaders(h({ "x-player-id": "abc", "x-player-login": "ooga" })), null);
  assert.equal(playerFromHeaders(h({ "x-player-id": "42" })), null);
});

test("who may drive which Ooga: owners only their own, others only while the owner is away and nobody holds it", async () => {
  const { castIndex, claimRefusal } = await import("../src/protocol.js");
  const cast = castIndex([
    { handle: "bc1gui", github_login: "ottoz0r" },
    { handle: "portlandhodl", github_login: "portlandhodl" },
    { handle: "rules-without-rulers", github_login: "rules-without-rulers" },
  ]);
  const room = (...players) => players.map(([login, body = null]) => ({ login, body }));
  // A contributor, known by GitHub login: their own Ooga, and nothing else.
  assert.equal(claimRefusal(cast, "ottoz0r", "bc1gui", room()), null);
  assert.equal(claimRefusal(cast, "OTTOZ0R", "BC1GUI", room()), null);
  assert.equal(claimRefusal(cast, "ottoz0r", "portlandhodl", room()), "not-yours");
  // A handle is a name, not a login: another account called bc1gui owns nothing.
  assert.equal(claimRefusal(cast, "bc1gui", "bc1gui", room(["ottoz0r"])), "owner-here");
  // A visitor: only while the owner is away and nobody else holds it.
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room()), null);
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room(["portlandhodl"])), "owner-here");
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room(["someone", "portlandhodl"])), "taken");
  assert.equal(claimRefusal(cast, "visitor", "portlandhodl", room(["visitor", "portlandhodl"])), null);
  assert.equal(claimRefusal(cast, "visitor", "nobody-real", room()), "unknown");
  assert.equal(claimRefusal(cast, "visitor", null, room(["portlandhodl"])), null);
  // Eligibility is a Worker-vouched flag, persisted in the room's attachment.
  assert.equal(claimRefusal(cast, "new-ooga", "new-ooga", room()), "unknown");
  assert.equal(claimRefusal(cast, "new-ooga", "NEW-OOGA", room(), true), null);
  assert.equal(claimRefusal(cast, "new-ooga", "portlandhodl", room(), true), "not-yours");
  assert.equal(claimRefusal(cast, "visitor", "new-ooga", room(["new-ooga", "new-ooga"])), "unknown");
  assert.equal(claimRefusal(cast, "ottoz0r", "ottoz0r", room(), true), "not-yours");
  assert.equal(claimRefusal(cast, "ottoz0r", "bc1gui", room(), true), null);
  assert.equal(claimRefusal(cast, "bc1gui", "bc1gui", room(["ottoz0r"]), true), "owner-here");
});

test("voice: players driving an Ooga hear each other while in the same place; nobody else does", async () => {
  const { voicePeers, parseClientMessage } = await import("../src/protocol.js");
  const on = { pub: "p", sub: "s", track: "mic" };
  const p = (id, body, zone, voice = on) => ({ id, body, zone, voice });
  const players = [
    p(1, "bc1gui", "outside"), p(2, "portlandhodl", "outside"), p(3, "w-s-bitcoin", "cave-lab"),
    p(4, null, "outside"), p(5, "MrHodlX", "outside", { pub: null, sub: "s", track: null }), p(6, "DrNeski", "outside", { pub: "p", sub: null, track: "mic" }),
    p(7, "timechainb", "cave-lab"), p(8, "Tmmmemcee", "hq"),
  ];
  const peers = voicePeers(players);
  assert.deepEqual(peers.get(1), [2, 6]);
  assert.deepEqual(peers.get(2), [1, 6]);
  assert.deepEqual(peers.get(3), [7], "a cave hears only its own");
  assert.deepEqual(peers.get(7), [3]);
  assert.deepEqual(peers.get(8), [], "alone in HQ hears nobody outside it");
  assert.deepEqual(peers.get(4), [], "not driving an Ooga hears nobody");
  assert.deepEqual(peers.get(5), [1, 2, 6], "listening without a microphone is allowed");
  assert.deepEqual(peers.get(6), [], "no receiving session, nothing to hear");
  assert.deepEqual(parseClientMessage('{"t":"zone","name":"cave-lab"}'), { t: "zone", name: "cave-lab" });
  assert.equal(parseClientMessage('{"t":"zone","name":"Cave Lab!"}'), null);
});

test("NPC host: the page longest in the room among those showing the island; nobody when none does", async () => {
  const { electHost, parseClientMessage } = await import("../src/protocol.js");
  const p = (id, joinedAt, inHub) => ({ id, joinedAt, inHub });
  assert.equal(electHost([p(1, 100, true), p(2, 50, true), p(3, 10, false)]), 2);
  assert.equal(electHost([p(1, 100, true), p(2, 100, true)]), 1, "a tie goes to the lower id");
  assert.equal(electHost([p(1, 100, false)]), 0);
  assert.equal(electHost([]), 0);
  assert.deepEqual(parseClientMessage('{"t":"hub","on":true}'), { t: "hub", on: true });
  assert.equal(parseClientMessage('{"t":"hub","on":"yes"}'), null);
});

test("NPC followers: every other page showing the island, so a lone host sends nothing", async () => {
  const { electHost, npcFollowers } = await import("../src/protocol.js");
  const p = (id, joinedAt, inHub) => ({ id, joinedAt, inHub });
  const alone = [p(1, 10, true), p(2, 20, false)];
  assert.equal(npcFollowers(alone, electHost(alone)), 0, "a page elsewhere or hidden does not follow");
  const two = [p(1, 10, true), p(2, 20, true), p(3, 30, false)];
  assert.equal(npcFollowers(two, electHost(two)), 1);
  assert.equal(npcFollowers(two, 0), 0, "no host, no followers");
});

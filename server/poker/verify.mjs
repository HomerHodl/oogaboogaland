// Independent local verification. Does not contact the relay or load code from a record.
import { readFileSync, statSync } from "node:fs";
import { loadProtocol } from "./load.mjs";

try {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node server/poker/verify.mjs hand.json");
  if (statSync(path).size > 12 * 1024 * 1024) throw new Error("Record exceeds the size limit");
  const record = JSON.parse(readFileSync(path, "utf8")), BL = loadProtocol();
  const match = await BL.pokerMatch.replay(record), state = match.state();
  process.stdout.write(JSON.stringify({ protocol: record.protocol, root: record.root, status: state.phase,
    complete: state.phase === "complete", shuffleContributions: state.shuffleAt, players: state.context.members.length,
    cardsOpenedPublicly: state.state.board.filter(Number.isInteger).length + state.state.seats.reduce((n, s) => n + (s?.cards.filter(Number.isInteger).length || 0), 0),
    result: state.state.result, note: "Checks this transcript, not entropy quality, client delivery, collusion, or starting account balances. Experimental, unaudited protocol." }, null, 2) + "\n");
  if (state.phase !== "complete") process.exitCode = 2;
} catch (error) { process.stderr.write("Verification failed: " + error.message + "\n"); process.exitCode = 1; }

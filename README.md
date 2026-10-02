# Ooga Booga Land

A WebGL2 floating island whose cliff caves hold projects and an arcade of games. Voxel cavemen stand in for the contributors of [OogaBoogaX](https://github.com/OogaBoogaX); donated bananas feed them, the live Bitcoin mempool makes the weather, and the rim Oogatron shows the org's live stats. Plain JavaScript, no dependencies, read-only network connections only. Payments are a simulator for now; visitor state stays in the visitor's browser.

## Run it

Open `src/index.html` in a browser, or serve `src/` with any static server.

```sh
npm run serve   # build and stage the site, then serve it at http://127.0.0.1:8080/ (try /oogarally)
npm run watch   # the same, rebuilding on every change under src/
```

`PORT` picks another port and `HOST=0.0.0.0` opens the server to the network. Reload the tab after a rebuild.

## The island

- **Fly:** **W A S D**, **Q E** turn, **Z**/**Space** up, **X** down; drag to orbit, scroll to zoom. On a phone the left stick moves and the right stick looks.
- **Play an Ooga:** double-tap one. Hold **Left Shift** while moving to run. **Space** jumps (twice for a double jump) and uses whatever is beside you; **Escape** lets go.
- **Factory ladders:** walk into a ladder to attach automatically. **W/S** climb up/down, **A/D** shift sideways, and **Space** jumps off. Walking outward onto a ladder from its upper landing starts a descent; release the movement key, then use **W/S** to change direction.
- **Play a gorilla:** double-click or double-tap one to take control. **W A S D** walks, hold **Left Shift** to run, and **Space** jumps with an optional second jump in the air. Walking and running use the same speeds and animations as the NPC gorillas.
- **Gorilla views:** **X** switches carry/combat. Scroll between first person, shoulder, and orbit/bird's-eye; combat shows the same crosshair. **Right-click** returns to shoulder, **Right Shift** swaps shoulders (**Right Shift + A/D** peeks), and **Q/E** rotate bird's-eye with **N** for north. **C** beats its chest.
- **Views:** **X** switches carry and combat. Combat has first-person, shoulder and birds-eye (scroll out from shoulder); in birds-eye the mouse points your Ooga, **Q E** rotate and **N** turns north up. **Right-click** returns to shoulder. In shoulder view, **Right Shift + A/D** peeks; tap **Right Shift** to switch shoulders.
- **Weapons:** **G** switches, **1** club, **2** rifle. **Left mouse** fires or swings (hold to charge), **F** strikes with the rifle in combat mode, **R** swaps magazines, **Space** at the pile reloads. Boxes, barrels and rocks break and drop pickups; the mirror cracks and heals.
- **Reset:** **Right Shift + R** resets saved progress. **Left Shift + R** keeps running while swapping magazines.
- **Jetpack:** **J** puts it on; hold **Space** to climb.

Roster colours show activity across every OogaBoogaX repo: yellow worked in the last hour, orange in the last day, gray asleep. Working Oogas load bananas at the pile and shoot them into their project's cave, where their gorilla companions build. HQ's ramps lead down to a basement of beds.

Around the rim: **EntropyLab** (11 o'clock), the **Lightning Factory** (2), **Ooga Arcade** (3), where a cabinet opens each game, the **Mempool island** (4) and the **Timechain Sphere** (southwest). Every game opens on a title card; **Enter** starts, **Escape** leaves.

## Timechain Sphere

Sani's hangout: a walk-in sphere whose six inner walls show live [Timechain Index](https://timechainindex.com) data (BTC distribution, address balances, UTXO sizes, ETF and exchange holdings, top holders). The walls load once you come near and refresh every five minutes. Tap a wall for a close-up and its source; tap Sani to spin his chair. Holdings are on-chain balances and API attributions, not proof of ownership. `timechain=0` turns the feed off.

## Games

- **The Ember Den:** walk through its window in ₿IFRÖST, beside DSB Land's, straight into a room of ten poker tables, nine seats each, suited gorilla dealers and five cave themes. Local practice plus an experimental encrypted-deck multiplayer service (`npm run poker:serve`), private dealing and downloadable hand verification. Free play chips, no payments or rake. See [status](docs/banana-poker.md) and [protocol and service instructions](docs/poker-protocol.md).
- **Ooga Rally:** three laps on one of three tracks. **W** go, **S** brake, **A D** steer, hold **Space** to drift and release to boost, **E** throws your item. Win gold in the Cup to open Mirror.
- **Ooga Drop:** jump from the plane, fly through eight hoops (**W S** pitch, **A D** roll, **Q E** turn), **Space** pulls the chute, land on the pile.
- **Ooga Orbit:** build a rocket, launch, reach the Sky Top at 500 up, spacewalk to measure the space rock (**V**), then fall home shield first and chute onto the pad.
- **Ooga Mine:** a mining tycoon about margin. Place gear, watch power, heat and the halving, put out fires, and mine 21 coin within the hour. **W A S D** walk, **Space** works, **V** looks round, **P** pauses; the run saves as you go.
- **The Agent:** double-click it to play; **Left Shift** gallops, **Space** jumps, and a second press while airborne adds a double jump. Each jump is 50% higher than an Ooga's. **C** beats its chest. **Right Shift + A** summons or releases it in scenes with an Agent.

## Weather

The mempool is the weather over the Mempool island: the fee-paying backlog sets how hard it rains (six steps, dry to downpour), incoming transactions set the wind, and every block strikes lightning.

## Debug

Each game and cave has an address to share, with its own preview card: `/oogarally`, `/oogadrop`, `/oogaorbit`, `/oogamine`, `/mempool`, `/dsb`, `/entropylab`, `/lightning` and `/sphere`. They work on the site and under `npm run serve`, and as `oogaboogaland.html#/oogarally` when the file is opened from disk; routes live in `src/js/routes.js`, and `npm run cards` recaptures the cards. `?scene=lab`, `race`, `drop`, `orbit`, `mine` or `dsb` opens that scene; `?nosim=1` silences the simulator and every feed; `?canvas2d=1` forces the Canvas 2D fallback; `?debug=1` exposes `window.__ooga`. AGENTS.md lists every flag and fixture.

With `debug=1`, repeat `ooga=<handle>:<mode>[:<caves>]` to set individual owners to `clank`, `chill` or `sleep`. Once any `ooga` flag is present, unlisted owners and omitted/invalid modes sleep, including maintainers and Sani. This fixture overrides `status=` and live activity for the visit; without `ooga`, normal activity and the existing debug defaults apply. GitHub logins also work. Repeating an owner replaces its earlier setting. The companion gorillas follow their owners' modes.

Clanking requires a comma-separated cave list: `lab` for EntropyLab, `obl` for Ooga Booga Land, and `lf` for Lightning Factory. Cave IDs (`c11`, `c1`, `c2`) and repository names (`oogaboogax/entropylab`, `oogaboogax/oogaboogaland`, `drneski/lightning-foundry`) also work. Unknown caves are ignored; a clank entry with no valid caves sleeps. Workers cycle through only their listed repositories. `&ooga=` makes everyone sleep. LF work routing is enabled for this debug fixture.

Example: five clanking owners, five chilling owners, and everyone else sleeping. w-s-bitcoin visits all three repositories, portlandhodl visits lab/OBL, DrNeski visits lab/LF, bc1gui visits the lab, and 2140data visits OBL. Append this query to the built page's address:

```text
?debug=1&nosim=1&ooga=w-s-bitcoin:clank:lab,obl,lf&ooga=portlandhodl:clank:lab,obl&ooga=DrNeski:clank:lab,lf&ooga=bc1gui:clank:lab&ooga=2140data:clank:obl&ooga=SaniExp:chill&ooga=MrHodlX:chill&ooga=Holo-Elfstone:chill&ooga=Tmmmemcee:chill&ooga=YellowBrokeIt:chill
```

In the hub, `?debug=1&character=gorilla-SaniExp` starts controlling SaniExp's gorilla. `clanker-SaniExp` is an equivalent selection, and both prefixes work with `solo=1`. A sleeping selected contributor is woken for this debug visit. Click the canvas to focus combat controls.

While controlling a gorilla, **Space** jumps immediately; press it again in the air for the optional second jump. Holding does not charge or repeat. Walk toward a nearby climbable wall or edge to mount it. On the wall, **W/S** climb up/down and **A/D** move sideways; combine them for diagonal climbing. Automatic mounting and dismounting preserve the camera's position; look and zoom remain available, and camera following resumes smoothly when you move again.

With `?debug=1&gorillamove=1`, use detached mode to click a gorilla, then click its destination on the ground, a ledge or a wall. The selected gorilla stays highlighted and plans walking and climbing from its current position. Wall routes can move sideways or diagonally while keeping the gorilla facing the stone. Click another destination to redirect it; **Escape** deselects it. A marker and status show its progress, and a blocked climb stays in place for inspection. The former `climbers=1` flag is an alias for this mode.

## Test

```sh
npm test
```

A headless Chrome suite over the DevTools protocol, a clean console required. Needs Node 22+ and Chrome (`CHROME` points at the binary off macOS). `npm run test:full` is the full gate.

## Build and deploy

```sh
npm run build
```

Writes `oogaboogaland.html`, one self-contained page with the content policy pinned to its hashes. CI commits it back after each merge to `rock`, and GitHub Pages serves it at https://oogaboogax.github.io/oogaboogaland/.

To add your Ooga, add one file to `src/characters/` named after your GitHub handle; click **2140data** on the island for a prompt that walks you through it.

## Privacy

No analytics and no personal data. Read-only requests only, nothing about the visitor sent: mempool.space (falling back to Esplora), Coinbase and other public price feeds, the oogatron stats worker and Timechain Index. The donation handle and message stay in localStorage.

DSB Land additionally contacts public Bitcoin feeds and radio/media services; payment is always an explicit action in the visitor's wallet. Zuzu uses local mock replies and deterministic fallback and sends no conversations to an AI provider. Its provider-neutral backend is prepared but not deployed.

## License

Public domain under [The Ooga Booga License](LICENSE), a caveman-speak dedication with the meaning of The Unlicense.

## Contributing

Read [AGENTS.md](AGENTS.md) first: the module layout, the engine patterns, how to add things, and the checks every change must pass.

## DSB Land

Reached through **₿IFRÖST** beyond the north pass. Walk through the DSB window in its chamber. To come home, use the **DSB Dialer** beside the upright gate and walk back through it into ₿IFRÖST.

Inside: a river boat and the **Bitcoin coaster** (ride on the live price), the **Meme Shop** (demo tokens for snacks and tomatoes), and **NodeRunner TV**, whose radio takes song requests paid over Lightning from your own wallet. **Turtle view** shows the whole land. A direct visit is `?scene=dsb`.

### Zuzu

Zuzu is DSB Land's physical black cat. Approach her and choose **Talk to Zuzu** for a compact free-form conversation panel. Replies are currently clearly labelled local mocks, with deterministic fallback; no real AI provider is connected. Conversation history resets when leaving DSB. The provider-neutral backend foundation is documented in [server/zuzu/README.md](server/zuzu/README.md); it is not deployed or bundled into the game.

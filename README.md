# Rail Routes

An online route-building train game for 2–8 players, played in the browser.

## Run it

```
npm install
npm start
```

Then open http://localhost:3000. One person clicks **Create a room** and shares the 4-letter code; everyone else enters it and clicks **Join**. The host starts the game.

To play with friends over the internet, the server has to be reachable from outside your network. Options:

- **Quick test:** a tunnel such as `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000` gives you a public link to your running server.
- **Always on:** deploy to a Node host (Render, Railway, Fly.io…). The server reads the `PORT` environment variable and the start command is `npm start`.

Games live in memory, so restarting the server ends any games in progress. A refreshed tab rejoins its seat automatically.

## Rules (test version)

- Everyone starts with 4 train cards and 3 destination tickets (keep at least 2).
- On your turn do **one** of:
  - **Draw 2 cards** from the 5 face-up cards or the deck. Taking a face-up rainbow counts as your whole turn, and it can't be your second card. If 3 rainbows are face up, the row is redealt.
  - **Claim a route** by paying cards equal to its length in the route's color. Tan routes take any one color. Rainbows are wild.
  - **Draw 3 tickets** and keep at least 1.
- Double routes: with 2–3 players only one track can be used; with 4+ different players can take each track. Nobody can take both.
- Route points by length: 1→1, 2→2, 3→4, 4→7, 5→10, 6→15.
- When someone ends a turn with 2 or fewer trains, everyone (including them) gets one final turn.
- Final scoring: completed tickets add their points, unfinished ones subtract them, and the longest continuous route gets +10.
- Trains per player shrink with table size because the test map is small (30 for 2–3 players, down to 13 for 8). With 6+ players the deck is 1.5× larger.

## Project layout

- `shared/map.js`: cities, routes and generated tickets for the test map
- `server/game.js`: rules engine (all game logic and validation lives here)
- `server/server.js`: static file server, plus WebSocket rooms
- `public/`: browser client
- `TrainCards/` → exported to `public/cards/` (the train cards)
- `Traincarsprites/` → exported to `public/cars/` (the cars drawn on claimed routes; one per player colour, matched in `CAR_SPRITES` in `public/client.js`)
- `TrainSpaces/` → exported to `public/spaces/` (empty track spaces, one per card colour; `Grey` is saved as `any.png` for any-colour routes)

To re-export art after editing it in Aseprite:

```
"C:\Program Files (x86)\Steam\steamapps\common\Aseprite\Aseprite.exe" -b TrainCards/RedTrain.aseprite --save-as public/cards/red.png
"C:\Program Files (x86)\Steam\steamapps\common\Aseprite\Aseprite.exe" -b Traincarsprites/redtraincar.aseprite --save-as public/cars/red.png
```

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
- Double routes: both tracks can always be claimed, by different players. Nobody can take both.
- Route points by length: 1→1, 2→2, 3→4, 4→7, 5→10, 6→15.
- When someone ends a turn with 2 or fewer trains, everyone (including them) gets one final turn.
- Final scoring: completed tickets add their points, unfinished ones subtract them, and the longest continuous route gets +10.
- Route points by length continue for long custom routes: 7→18, 8→21.
- Trains per player shrink with table size (30 for 2–3 players on the test map, down to 13 for 8; bigger or smaller maps scale this). With 6+ players the deck is 1.5× larger.

## Map editor

Open `/editor.html` (there's a "Make your own map" link on the home screen).

1. **Load image…** in the Map panel to use a picture as the background. Small images are treated as pixel art and kept sharp. Under **Edit image** you can rotate 90°, flip, tilt by any angle (to straighten a photo or scan), and **Crop…** by dragging a box. Cities and routes move with the image.
2. With the **Cities** tool (C), click the map to add a city and type its name. Drag cities to move them.
3. With the **Routes** tool (R), click a city, click on the map to add bend points, then click the city it goes to. Esc cancels.
4. Select a route to set its colour (grey = any colour), make it a double route, or change its length. Length is worked out from how long the route is drawn (1–8 spaces); **Track space size** changes that for every route. Drag the white dots to reshape a curve; double-click a route to add a bend, double-click a dot to remove it.
5. The **Ready to play?** box lists problems, such as cities with no routes or too few tickets. Tickets are generated automatically from the routes.

Work is saved in the browser as you go, and **Save map file** downloads a `.railmap.json` file. In a game lobby the host clicks **Use "…" from editor** (same browser) or **Load map file…** (any browser). Trains per player scale with how much track the map has.

## Project layout

- `shared/map.js`: the test map, and the code that checks any map and builds its routes and tickets (used by the server and the editor)
- `public/layout.js`: where track spaces go along a (possibly curved) route
- `public/editor.html`, `public/editor.js`: the map editor
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

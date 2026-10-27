# Demonstrate review across a real restart

Run the build first. Start the app using a dedicated data directory:

```powershell
npm.cmd start -- --mode anthropic --data-dir data/restart-demo --port 4313
```

1. Open the printed loopback address. Choose **GST rounding**, then **Load example**.
2. Wait for **Awaiting review**. Inspect the two source records and their fictional policies. The totals are AUD 22.12 and AUD 22.11, with a one-cent difference.
3. Stop the app with Ctrl+C while approval is still pending. Leave the browser tab open.
4. Start it again with the same command and data directory. Reload the browser tab. Its session token is new; the proposal, evidence versions and history are the same.
5. Accept the explanation. The status becomes **Reviewed / explained**, and both source amounts remain unchanged.
6. Inspect investigation history. One review decision and one terminal outcome are recorded.

For an API replay demonstration, save the body and idempotency key of the decision request using browser developer tools, then send the same body again with the current session token. The API returns the existing intent rather than applying another outcome. Automated tests exercise this replay and conflicting requests without relying on developer tools.

Claude mode needs the ignored local `.env` with `ANTHROPIC_API_KEY` and uses the persistent USD 5 application budget described in the README. To demonstrate the same workflow without paid calls, use `--mode fake` and a separate data directory. Saved paused-review recovery does not request a new explanation.

Choose **Missing evidence** to see an unresolved case with no acceptance action. **Unexplained mismatch** has complete evidence that cannot account for its difference under the supported profiles. **Exact match** bypasses either model adapter.

Automated cross-process checks run under `npm test`. They terminate and relaunch Node at four boundaries: after intent commit, before outcome commit, after outcome commit but before the graph checkpoint, and after the checkpoint but before the intent is marked consumed.

The runtime badge and each proposal identify their model. Scripted restart tests prove local workflow persistence; the separate dated live evaluation measures the actual Claude path on a small synthetic sample.

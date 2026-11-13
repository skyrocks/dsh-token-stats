# dsh-token-stats

DeepSeek Harness plugin: a **Settings → Token usage** page that totals model token consumption for every
session by **day / week / month**, including subagent sessions.

It shows overall tokens, input, cache reads and writes, output, call counts, a trend chart, and the per-model split.

## Why a separate plugin

The conversation Statistics tab only covers the **current** session. Answering "how many tokens did I use this
month" needs every session, subagents included, and it must survive restarts. This plugin folds the `usage` of
every `assistant/message` event in the local session logs into one ledger, cuts it by the machine's local time
into days / weeks / months, backfills history once, and then updates incrementally.

It never calls a model, never changes a session, and never appends session events. The ledger is a separate file.

## Install

Install this directory with `install_bundle`, or use **Settings → Plugins → Add plugin**, then restart DSH.
The page lives at **Settings → Token usage** (bar-chart icon in the settings navigation).

## What the page shows

- **Today / This week / This month** cards: total tokens, input, cache, output, and call count.
- **Trend**: by day (last 14 days), by week (last 12 weeks, Monday start), by month (last 12 months). Every bar
  shows its value above it and stacks input / cache / output; hover for the full split.
- **Model split** over the selected trend window (last 14 days / 12 weeks / 12 months), sorted by volume with share bars.
- **Session usage**: the same window ranked by session, with the session title, call count, last activity, and share. The first five rows show by default; **Load more** adds ten at a time and the list can be collapsed. Titles come from the browser-side session list (the same data the sidebar uses), so no log reads are needed; a row without a title falls back to a short id.
- A **history backfill progress** banner on the first visit; the page can be closed while the Host keeps scanning.
- While open, the page refreshes itself every 30 seconds (1.2 seconds during backfill) and immediately when the tab
  returns to the foreground.

## Counting rules

| Field | Meaning |
|---|---|
| Input | Uncached input tokens (`inputTokens`) |
| Cache | `cacheReadTokens` + `cacheWriteTokens`, listed separately |
| Output | `outputTokens` |
| Total | Input + cache + output (provider `totalTokens` is not trusted because it may be missing) |
| Calls | One `assistant/message` with usage, or one `assistant/attempt` that still reported usage, counts as one call |

- Days follow the **local** timezone, weeks start **Monday**, months are calendar months.
- A **fork's inherited prefix is not counted twice**: the fold starts after `inheritedEventCount`.
- Only settlements that carry usage are counted; older adapters that reported none are skipped.
- A failed or retried attempt that still reported usage counts too (matching DSH's own token accounting); it has no
  model attribution and shows as an unknown model in the split.
- This is local ledger usage. The provider's billing page may also include internal calls such as title
  generation, so the two need not match.

## Configuration

Override by id in the profile's `cordis.patch.yml`:

```yaml
- id: token-stats
  config:
    historyDays: 365
    retainDays: 400   # auto-raised to at least 403 so 12 monthly bars stay visible
    dayCount: 14
    weekCount: 12
    monthCount: 12
    path: ~/.dsh/token-stats/usage.json
```

## Data and privacy

- Ledger: `$DSH_HOME/token-stats/usage.json` (mode 0600) with session id, event seq, time, model name, provider,
  and the four token counts. **No conversation text.**
- Delete the file to reset the ledger; the next visit backfills again.
- The one-time backfill reads persisted session logs locally and asynchronously; tens of sessions usually take
  a few seconds, with visible progress.
- Uninstalling keeps the file; remove it manually if you want.

## Known limitations

- Only settlements that report usage in the local logs are counted; the provider bill may also include internal
  calls such as title generation, so the two need not match.
- Backfill covers sessions created within the last 365 days (`historyDays`); older sessions stay out of the ledger.
- The first visit reads the history once; later starts do not rescan.
- Model split and session ranking return at most 300 rows each; five rows show by default and **Load more** reveals the rest.
- Session rows are statistics only and do not open the session.
- Values use Chinese units (万 / 亿); hover a card value for the exact number.

## Tests

```sh
node test/smoke.mjs       # folding, bucket boundaries, series, config and store normalization
node test/accountant.mjs  # incremental folding, fork dedupe, backfill, restart recovery, pruning
node test/client.mjs      # client module load and settings section / icon slot registration
```

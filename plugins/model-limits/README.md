# model-limits

Publishes the per-model weekly rate-limit windows (`Current week (Fable)` on `/usage`) to
`~/.claude/model-limits.json`, so a status line script can draw them next to the 5-hour and
7-day windows. Those two reach a status line script on stdin; the per-model windows do not
(Claude Code 2.1.294 passes only `five_hour`, `seven_day` and `spend_limit`), and the plugin
API's `$.session.usage()` carries the same three, so this plugin reads the usage endpoint
itself with the session's credential (`$.session.authorize()`: the token never reaches the
plugin) and writes what the status line lacks.

The file is rewritten at session start and after a turn whose rate-limit reading moved,
at most once every five minutes (Claude Code's own cadence for the endpoint):

```json
{ "fetched_at": 1760000000, "windows": [ { "name": "Fable", "used_percentage": 12.3, "resets_at": 1792047600 } ] }
```

`resets_at` is in epoch seconds, like the windows on stdin; `null` when the server gives
none. A session without a first-party credential (an API key, a gateway, a third-party
provider) writes nothing.

## Reading it from a status line script

```sh
jq -r '.windows[] | select(.resets_at == null or .resets_at > now) | "\(.name) \(.used_percentage)% ↻ \(.resets_at)"' ~/.claude/model-limits.json
```

Drop a window past its reset, as Claude Code drops its own, and treat a file older than a
day as the plugin not running.

## Install

```
/plugin install model-limits --marketplace penso-technology/claude-plugins
```

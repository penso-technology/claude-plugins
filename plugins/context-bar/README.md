# context-bar

Draws the context window as a stacked bar above the prompt, one colour per `/context` category,
followed by percent used and tokens used over the window. A second row lists the used categories
with their token counts. Deferred tool schemas are left out, as `/context` leaves them out of its grid.

The reading refreshes after every turn with the local estimate (`/context`'s summary mode); it
sends no token-count requests.

## Command

`/context-bar` shows or hides the bar. Showing it refreshes the reading first.

## Install

```
/plugin install context-bar --marketplace penso-technology/claude-plugins
```

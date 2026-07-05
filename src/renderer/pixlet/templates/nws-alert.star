load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    severity = display.get("severity") or "ALERT"
    event = display.get("event") or "NWS Alert"
    headline = display.get("headline") or ""
    message = display.get("message") or (event + " " + headline)
    color = "#f00"
    if severity == "WATCH":
        color = "#fa0"
    elif severity == "ADVISORY":
        color = "#fc0"

    return render.Root(
        delay = 50,
        show_full_animation = True,
        child = render.Stack(
            children = [
                render.Box(width = 64, height = 1, color = color),
                render.Padding(
                    pad = (0, 31, 0, 0),
                    child = render.Box(width = 64, height = 1, color = color),
                ),
                render.Padding(
                    pad = (0, 0, 0, 0),
                    child = render.Box(width = 1, height = 32, color = color),
                ),
                render.Padding(
                    pad = (63, 0, 0, 0),
                    child = render.Box(width = 1, height = 32, color = color),
                ),
                render.Padding(
                    pad = (3, 3, 0, 0),
                    child = render.Text(content = severity[:7], color = color),
                ),
                render.Padding(
                    pad = (40, 3, 0, 0),
                    child = render.Text(content = "NWS", color = "#999"),
                ),
                render.Padding(
                    pad = (3, 11, 0, 0),
                    child = render.Marquee(
                        width = 58,
                        child = render.Text(content = message, color = "#fff"),
                        offset_start = 0,
                        offset_end = 58,
                    ),
                ),
                render.Padding(
                    pad = (3, 22, 0, 0),
                    child = render.WrappedText(
                        content = headline,
                        width = 58,
                        height = 8,
                        color = "#999",
                    ),
                ),
            ],
        ),
    )

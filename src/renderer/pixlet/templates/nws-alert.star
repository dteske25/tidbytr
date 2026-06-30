load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    alert = data.get("payload") or {}
    severity = (alert.get("severity") or "alert").upper()
    event = alert.get("event") or "NWS Alert"
    headline = alert.get("headline") or ""
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
                    child = render.Text(content = severity, color = color),
                ),
                render.Padding(
                    pad = (3, 11, 0, 0),
                    child = render.Marquee(
                        width = 58,
                        child = render.Text(content = event + " " + headline, color = "#fff"),
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


load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    temp = display.get("temp") or "--F"
    high_low = display.get("highLow") or "H- L-"
    wind = display.get("wind") or ""
    summary = display.get("summary") or "Forecast unavailable"

    return render.Root(
        child = render.Stack(
            children = [
                render.Box(width = 64, height = 1, color = "#036"),
                render.Padding(
                    pad = (4, 4, 0, 0),
                    child = render.Circle(diameter = 9, color = "#fc0"),
                ),
                render.Padding(
                    pad = (11, 13, 0, 0),
                    child = render.Box(width = 17, height = 5, color = "#eef"),
                ),
                render.Padding(
                    pad = (31, 3, 0, 0),
                    child = render.Text(content = temp, font = "6x13", color = "#fff"),
                ),
                render.Padding(
                    pad = (31, 17, 0, 0),
                    child = render.Text(content = high_low, color = "#9cf"),
                ),
                render.Padding(
                    pad = (3, 21, 0, 0),
                    child = render.Text(content = wind, color = "#777"),
                ),
                render.Padding(
                    pad = (3, 25, 0, 0),
                    child = render.Marquee(
                        width = 58,
                        child = render.Text(content = summary, color = "#28f"),
                        offset_start = 0,
                        offset_end = 58,
                    ),
                ),
            ],
        ),
    )

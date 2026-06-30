load("encoding/json.star", "json")
load("render.star", "render")
load("time.star", "time")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    timezone = data.get("timezone") or config.get("timezone") or "UTC"
    now = time.now().in_location(timezone)

    return render.Root(
        delay = 500,
        child = render.Stack(
            children = [
                render.Box(width = 64, height = 2, color = "#0b5"),
                render.Padding(
                    pad = (5, 7, 0, 0),
                    child = render.Animation(
                        children = [
                            render.Text(content = now.format("15:04"), font = "6x13", color = "#fff"),
                            render.Text(content = now.format("15 04"), font = "6x13", color = "#fff"),
                        ],
                    ),
                ),
                render.Padding(
                    pad = (15, 23, 0, 0),
                    child = render.Text(content = now.format("Jan 02"), color = "#28f"),
                ),
                render.Padding(
                    pad = (2, 29, 0, 0),
                    child = render.Box(width = 60, height = 1, color = "#014"),
                ),
            ],
        ),
    )


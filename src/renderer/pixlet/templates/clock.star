load("encoding/json.star", "json")
load("render.star", "render")
def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    time_text = display.get("time") or "--:--"
    blink_time = display.get("blinkTime") or time_text
    date_text = display.get("date") or "--- --"

    return render.Root(
        delay = 500,
        child = render.Stack(
            children = [
                render.Box(width = 64, height = 2, color = "#0b5"),
                render.Padding(
                    pad = (6, 5, 0, 0),
                    child = render.Animation(
                        children = [
                            render.Text(content = time_text, font = "6x13", color = "#fff"),
                            render.Text(content = blink_time, font = "6x13", color = "#fff"),
                        ],
                    ),
                ),
                render.Padding(
                    pad = (15, 22, 0, 0),
                    child = render.Text(content = date_text, color = "#28f"),
                ),
                render.Padding(
                    pad = (2, 29, 0, 0),
                    child = render.Box(width = 60, height = 1, color = "#014"),
                ),
            ],
        ),
    )

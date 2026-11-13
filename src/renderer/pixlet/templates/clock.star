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
                render.Padding(
                    pad = (display.get("timeX") or 7, 0, 0, 0),
                    child = render.Animation(
                        children = [
                            render.Text(content = time_text, font = "10x20", color = "#fff"),
                            render.Text(content = blink_time, font = "10x20", color = "#fff"),
                        ],
                    ),
                ),
                render.Padding(
                    pad = ((64 - len(date_text) * 5) // 2, 24, 0, 0),
                    child = render.Text(content = date_text, font = "5x8", color = "#fff"),
                ),
                render.Padding(
                    pad = (2, 21, 0, 0),
                    child = render.Box(width = 60, height = 1, color = "#EF4444"),
                ),
            ],
        ),
    )

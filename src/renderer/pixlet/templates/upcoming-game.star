load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    team = display.get("team") or "HOME"
    opponent = display.get("opponent") or "AWAY"
    detail = display.get("detail") or "TBD"

    return render.Root(
        child = render.Stack(
            children = [
                render.Box(width = 64, height = 2, color = "#fc0"),
                render.Padding(
                    pad = (2, 3, 0, 0),
                    child = render.Text(content = "NEXT", color = "#fc0"),
                ),
                render.Padding(
                    pad = (30, 3, 0, 0),
                    child = render.Text(content = detail, color = "#999"),
                ),
                render.Padding(
                    pad = (2, 13, 0, 0),
                    child = render.Marquee(
                        width = 60,
                        child = render.Text(content = team + " VS " + opponent, font = "6x13", color = "#fff"),
                        offset_start = 0,
                        offset_end = 60,
                    ),
                ),
            ],
        ),
    )


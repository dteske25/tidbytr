load("encoding/json.star", "json")
load("render.star", "render")

def main(config):
    data = json.decode(config.get("payload_json") or "{}")
    display = data.get("display") or {}
    team = display.get("team") or "HOME"
    opponent = display.get("opponent") or "AWAY"
    team_score = display.get("teamScore") or "--"
    opponent_score = display.get("opponentScore") or "--"
    detail = display.get("detail") or ""

    return render.Root(
        child = render.Stack(
            children = [
                render.Box(width = 64, height = 2, color = "#0f5"),
                render.Padding(
                    pad = (2, 3, 0, 0),
                    child = render.Text(content = display.get("header") or "LIVE", font = "tom-thumb" if display.get("sport") else "tb-8", color = "#0f5"),
                ),
                render.Padding(
                    pad = (32, 4, 0, 0),
                    child = render.Text(content = detail, font = "tom-thumb", color = "#CBD5DF"),
                ),
                render.Padding(
                    pad = (2, 11, 0, 0),
                    child = render.Text(content = team[:5], color = "#fff"),
                ),
                render.Padding(
                    pad = (39, 11, 0, 0),
                    child = render.Text(content = opponent[:5], color = "#fff"),
                ),
                render.Padding(
                    pad = (6, 20, 0, 0),
                    child = render.Text(content = team_score, font = "6x13", color = "#fff"),
                ),
                render.Padding(
                    pad = (43, 20, 0, 0),
                    child = render.Text(content = opponent_score, font = "6x13", color = "#fff"),
                ),
                render.Padding(
                    pad = (29, 21, 0, 0),
                    child = render.Box(width = 6, height = 2, color = "#0f5"),
                ),
            ],
        ),
    )

